import { describe, expect, it, vi } from "vitest";
import { APICallError, createGateway, type JSONValue } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, type ExtractInput } from "../extract";
import { callRefused } from "../refused";

type Json = Record<string, JSONValue>;

// The model is a vendor we don't own, so it's mocked (E5).
function modelReturning(json: unknown, gateway?: Json) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
      providerMetadata: gateway && { gateway },
    }),
  });
}

const input: ExtractInput = {
  relationship: "father",
  url: "https://www.instagram.com/p/x",
  title: "Instagram",
  text: "My vise finally gave out after 20 years.",
  note: null,
  screenshot: null,
  known: [],
};

const opts = { timeoutMs: 5000 };

const vise = { category: "wants", value: "a new rotary fly-tying vise", confidence: 0.9, evidence: "gave out" };

/** Everything the model was sent, as one string. */
function sent(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls[0].prompt);
}

describe("createExtractor", () => {
  it("returns the model's facts without the evidence", async () => {
    const model = modelReturning({ facts: [vise] });
    const { facts } = await createExtractor(model)(input, opts);
    expect(facts).toEqual([{ category: "wants", value: "a new rotary fly-tying vise", confidence: 0.9 }]);
  });

  it("returns an empty list when the model finds nothing", async () => {
    const { facts } = await createExtractor(modelReturning({ facts: [] }))(input, opts);
    expect(facts).toEqual([]);
  });

  it("describes the person by relationship only", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input, opts);
    expect(sent(model)).toContain("their father");
    expect(sent(model)).not.toMatch(/name/i);
  });

  it("lists what's already recorded so the model doesn't repeat it in other words", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, known: ["Already has: UCF pocket t-shirt (dark gray)", "Into: golf"] }, opts);
    expect(sent(model)).toContain("Already recorded about them");
    expect(sent(model)).toContain("Already has: UCF pocket t-shirt (dark gray)");
    expect(sent(model)).toContain("Into: golf");
    const system = model.doGenerateCalls[0].prompt.find((m) => m.role === "system")?.content;
    expect(system).toMatch(/already recorded.*even in other words/i);
  });

  it("leaves the recorded list out when nothing is known yet", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input, opts);
    expect(sent(model)).not.toContain("Already recorded about them");
  });

  it("tells the model that something only seen is owned, and never to pad the list", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input, opts);
    const system = model.doGenerateCalls[0].prompt.find((m) => m.role === "system")?.content;
    expect(system).toMatch(/seen with, using or wearing is "owns"/);
    expect(system).toMatch(/return an empty list/i);
    // Fixed scale, so the 60% cut means the same thing run to run (ai:eval missed golf without it).
    expect(system).toMatch(/0\.9 when the page says it outright; 0\.7 when it's clearly implied/);
    // A complaint is recorded as a dislike before any guessed gift (ai:eval missed june-1's squirrels).
    expect(system).toMatch(/a complaint is a "dislike"/);
  });

  it("sends the screenshot as an image when there is one", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, screenshot: { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg" } }, opts);
    const user = model.doGenerateCalls[0].prompt.find((m) => m.role === "user");
    expect(JSON.stringify(user)).toContain("image/jpeg");
  });

  it("sends the screenshot with its own media type", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, screenshot: { bytes: new Uint8Array([1, 2, 3]), type: "image/png" } }, opts);
    const user = JSON.stringify(model.doGenerateCalls[0].prompt.find((m) => m.role === "user"));
    expect(user).toContain("image/png");
    expect(user).not.toContain("image/jpeg");
  });

  it("sends no image when there is no screenshot", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input, opts);
    expect(sent(model)).not.toContain("image/jpeg");
  });

  it("labels the buyer's note as theirs", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, note: "He said this broke" }, opts);
    expect(sent(model)).toContain("Note from the person who captured this: He said this broke");
  });

  it.each([
    ["an unknown category", { ...vise, category: "mood" }],
    ["confidence above 1", { ...vise, confidence: 1.5 }],
    ["an empty value", { ...vise, value: "" }],
    ["a value over 200 characters", { ...vise, value: "x".repeat(201) }],
  ])("rejects output with %s", async (_label, fact) => {
    await expect(createExtractor(modelReturning({ facts: [fact] }))(input, opts)).rejects.toThrow();
  });

  it("gives up when the model takes longer than timeoutMs", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () => reject(abortSignal.reason))),
    });
    await expect(createExtractor(model)(input, { timeoutMs: 20 })).rejects.toThrow();
  });

  it("tries once: a failed call isn't retried, so the popup gets an answer in time", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "overloaded", url: "x", requestBodyValues: {}, statusCode: 529, isRetryable: true });
      },
    });
    await expect(createExtractor(model)(input, opts)).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});

describe("what a read cost (ALL-144 AC-3)", () => {
  const costOf = async (gateway?: Json) => (await createExtractor(modelReturning({ facts: [] }, gateway))(input, opts)).costCents;

  it("is the Gateway's dollars, in cents with fractions", async () => {
    expect(await costOf({ cost: "0.001966", marketCost: "0.5" })).toBeCloseTo(0.1966, 10);
    expect(await costOf({ cost: "0" })).toBe(0);
  });

  it.each([
    ["no metadata", undefined],
    ["no cost", { generationId: "gen_1" }],
    ["null", { cost: null }],
    ["blank", { cost: " " }],
    ["empty", { cost: "" }],
    ["negative", { cost: "-0.01" }],
    ["not a number", { cost: "free" }],
    ["partly a number", { cost: "0.01 USD" }],
    ["infinite", { cost: "Infinity" }],
    ["an object", { cost: { total: "0.01" } }],
  ] as [string, Json | undefined][])("is null when the reported cost is %s", async (_label, gateway) => {
    expect(await costOf(gateway)).toBeNull();
  });
});

// The real AI SDK and its Gateway provider throw these; only the network is faked.
describe("callRefused (ALL-144 AC-3)", () => {
  /** What the extractor throws when the Gateway answers `reply`. */
  async function thrown(reply: typeof fetch, timeoutMs = 5000): Promise<unknown> {
    const model = createGateway({ apiKey: "k", baseURL: "http://gateway.test", fetch: reply })("anthropic/claude-sonnet-5");
    let result: unknown;
    try {
      result = await createExtractor(model)(input, { timeoutMs });
    } catch (err) {
      return err;
    }
    throw new Error(`expected the read to fail, got ${JSON.stringify(result)}`);
  }
  const answer = (status: number, body: string) => thrown((async () => new Response(body, { status })) as typeof fetch);
  const error = (type: string | null) => JSON.stringify({ error: { message: "no", type } });

  it.each([
    [400, error("invalid_request_error")],
    [401, error("authentication_error")],
    [402, error("insufficient_funds")],
    [402, error("quota_for_entity_exceeded")],
    [402, error(null)],
    [403, error("forbidden")],
    [404, error("model_not_found")],
    [413, "too large, not JSON"],
    [429, error("rate_limit_exceeded")],
    [429, "slow down, not JSON"],
  ])("is true for HTTP %i %s", async (status, body) => {
    expect(callRefused(await answer(status, body))).toBe(true);
  });

  it.each([
    [408, error("timeout")],
    [500, error("internal_server_error")],
    [502, "<html>bad gateway</html>"],
    [503, error(null)],
    [529, error("overloaded")],
    [200, "cut off {"],
  ])("is false for HTTP %i %s, which may have been charged", async (status, body) => {
    expect(callRefused(await answer(status, body))).toBe(false);
  });

  it("is true for the missing sign-in, which the SDK reports without a status in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = await answer(401, error("authentication_error"));
    vi.unstubAllEnvs();
    expect(err).not.toHaveProperty("statusCode");
    expect(callRefused(err)).toBe(true);
  });

  it("is false when the network drops or time runs out", async () => {
    const dropped = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(callRefused(await thrown(dropped))).toBe(false);
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    expect(callRefused(await thrown(hanging, 20))).toBe(false);
  });

  it("is false for a paid reply that doesn't fit the schema", async () => {
    const err = await createExtractor(modelReturning({ facts: [{ ...vise, category: "mood" }] }))(input, opts).catch((e: unknown) => e);
    expect(callRefused(err)).toBe(false);
  });

  it("reads a direct provider's error the same way, and anything else as not refused", () => {
    const call = (statusCode?: number) => new APICallError({ message: "x", url: "x", requestBodyValues: {}, statusCode });
    expect(callRefused(call(429))).toBe(true);
    expect(callRefused(call(503))).toBe(false);
    expect(callRefused(call())).toBe(false);
    for (const other of [new Error("x"), "x", null, undefined, { statusCode: "402" }]) expect(callRefused(other)).toBe(false);
  });
});
