import { describe, expect, it, vi } from "vitest";
import { AiError, gatewayPrices, sendMessages, type GatewayHttp, type GatewayPrices } from "../messages";
import { brainstorm, rank, rankInputTokensMax, rankWorstCents, type BrainstormInput } from "../ideas";
import recorded from "./ideas.fixture.json";

const prices: GatewayPrices = { inputCentsPerToken: 0.001, outputCentsPerToken: 0.005, searchCents: 1 };
const signal = new AbortController().signal;
const usage = { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 3 } };

function http(reply: () => Response | Promise<Response>) {
  const fetch = vi.fn(async () => reply());
  const h: GatewayHttp = { base: "https://gw.test", apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch };
  return { h, fetch };
}
const messagesReply = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text: "thinking" }, { type: "text", text }], usage }));

const input: BrainstormInput = {
  relationship: "father",
  occasion: "birthday",
  budgetCents: 7500,
  facts: ["wants: a rotary vise"],
  avoidTitles: ["Old idea"],
};
const bo = { candidates: 8, maxSearches: 5, maxTokens: 6000, overBudgetPct: 15, prices, signal };
const keep = { keepMin: 3, keepMax: 5 };

describe("brainstorm", () => {
  it("sends web_search with max_uses and exactly the input it was given", async () => {
    const { h, fetch } = http(() => messagesReply(JSON.stringify({ ideas: [] })));
    await brainstorm(h, input, bo);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gw.test/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
    expect(body.max_tokens).toBe(6000);
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.system).toContain("Propose 8 distinct");
    expect(body.system).toContain("except at most one idea up to 15% over");
    const user = body.messages[0].content as string;
    expect(user).toBe(
      ["Occasion: birthday", "Budget: $75.00", "Buying for their father.", "Facts:", "- wants: a rotary vise", "Already suggested:", "- Old idea"].join("\n"),
    );
  });

  it("parses candidates and cost", async () => {
    const reply = {
      ideas: [
        { title: "A", search: "a thing", brand: "Acme", why: "because" },
        { title: "B", search: "b thing", brand: null, why: "also" },
        { title: "", search: "bad", brand: null, why: "dropped" },
      ],
    };
    const { h } = http(() => messagesReply("Here you go:\n```json\n" + JSON.stringify(reply) + "\n```"));
    const out = await brainstorm(h, input, bo);
    expect(out.candidates).toEqual([
      { id: "c1", title: "A", search: "a thing", brand: "Acme", why: "because" },
      { id: "c2", title: "B", search: "b thing", brand: null, why: "also" },
    ]);
    expect(out.costCents).toBeCloseTo(1000 * 0.001 + 200 * 0.005 + 3 * 1);
  });

  it("strips <cite> tags from titles and why in a recorded reply", async () => {
    const { h } = http(() => messagesReply(JSON.stringify(recorded)));
    const out = await brainstorm(h, input, bo);
    expect(out.candidates).toHaveLength(2);
    expect(recorded.ideas[0].why).toContain("<cite");
    for (const c of out.candidates) expect(`${c.title} ${c.why}`).not.toMatch(/<\/?cite/);
    expect(out.candidates[0].title).toContain("(tested)");
    expect(out.candidates[0].brand).toBe("Kingfisher");
  });

  it("bad JSON throws malformed, with no body text in the message", async () => {
    const { h } = http(() => messagesReply("SECRET-BODY not json"));
    const error = await brainstorm(h, input, bo).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe("malformed");
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("an unreadable priced reply throws malformed carrying its cost", async () => {
    const { h } = http(() => messagesReply("not json"));
    const error = await brainstorm(h, input, bo).catch((e) => e);
    expect(error.kind).toBe("malformed");
    expect(error.costCents).toBeCloseTo(1000 * 0.001 + 200 * 0.005 + 3 * 1);
    const { h: h2 } = http(() => messagesReply('{"other":1}'));
    expect((await rank(h2, { relationship: "x", facts: [], options: [] }, { maxTokens: 1, ...keep, prices, signal }).catch((e) => e)).costCents).toBeGreaterThan(0);
  });

  it("reads JSON after prose with brackets, and from a fenced block", async () => {
    const json = JSON.stringify({ ideas: [{ title: "A", search: "a", brand: null, why: "w" }] });
    for (const text of [`Here are [3] ideas: ${json} Enjoy.`, "Sure:\n```json\n" + json + "\n```\nDone [1]"]) {
      const { h } = http(() => messagesReply(text));
      expect((await brainstorm(h, input, bo)).candidates).toHaveLength(1);
    }
  });

  it("a reply with no ideas array throws malformed", async () => {
    const { h } = http(() => messagesReply('{"other":1}'));
    await expect(brainstorm(h, input, bo)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("a 5xx throws unavailable, with no body text in the message", async () => {
    const { h } = http(() => new Response("SECRET-BODY upstream exploded", { status: 503 }));
    const error = await brainstorm(h, input, bo).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe("unavailable");
    expect(error.message).not.toContain("SECRET-BODY");
  });

  it("an aborted signal rejects", async () => {
    const c = new AbortController();
    c.abort();
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return messagesReply("{}");
    });
    const h: GatewayHttp = { base: "https://gw.test", apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch };
    await expect(brainstorm(h, input, { ...bo, signal: c.signal })).rejects.toThrow();
  });
});

describe("cite tags", () => {
  it("are stripped from search and brand too, and only real cite tags are", async () => {
    const reply = {
      ideas: [
        {
          title: "<cite index=\"1-2\">Vise</cite>",
          search: "<cite index=\"3\">Griffin Montana Pro vise</cite>",
          brand: "<cite index=\"4\">Griffin</cite>",
          why: "Fits <citation> notes",
        },
        { title: "Only tags", search: "<cite index=\"5\"></cite>", brand: null, why: "no search left" },
      ],
    };
    const { h } = http(() => messagesReply(JSON.stringify(reply)));
    const out = await brainstorm(h, input, bo);
    expect(out.candidates[0]).toMatchObject({ title: "Vise", search: "Griffin Montana Pro vise", brand: "Griffin", why: "Fits <citation> notes" });
    expect(out.candidates).toHaveLength(1);
  });
});

describe("prompt numbers come from settings", () => {
  it("brainstorm says the account's over-budget allowance", async () => {
    const { h, fetch } = http(() => messagesReply(JSON.stringify({ ideas: [] })));
    await brainstorm(h, input, { ...bo, overBudgetPct: 22 });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.system).toContain("except at most one idea up to 22% over");
    expect(body.system).not.toContain("15%");
  });

  it("rank keeps the top idea_keep_min to idea_keep_max", async () => {
    const { h, fetch } = http(() => messagesReply(JSON.stringify({ order: [] })));
    await rank(h, { relationship: "x", facts: [], options: [] }, { maxTokens: 800, keepMin: 2, keepMax: 7, prices, signal });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.system).toContain("keep the top 2 to 7.");
    expect(body.system).not.toContain("3 to 5");
  });
});

describe("rank", () => {
  const rankInput = {
    relationship: "father",
    facts: ["wants: a rotary vise"],
    options: [
      { id: "c1", title: "Vise", totalCents: 5500, fit: "within" as const },
      { id: "c2", title: "Lamp", totalCents: 8000, fit: "over" as const },
    ],
  };

  it("drops ids it wasn't given and strips cite tags", async () => {
    const order = [
      { id: "c2", reason: "<cite index=\"1\">Light</cite> helps" },
      { id: "zzz", reason: "invented" },
      { id: "c1", reason: "Old vise died" },
    ];
    const { h, fetch } = http(() => messagesReply(JSON.stringify({ order })));
    const out = await rank(h, rankInput, { maxTokens: 800, ...keep, prices, signal });
    expect(out.order).toEqual([
      { id: "c2", reason: "Light helps" },
      { id: "c1", reason: "Old vise died" },
    ]);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("id c1: Vise, $55.00 delivered (within budget)");
    expect(out.costCents).toBeGreaterThan(0);
  });
});

describe("rankInputTokensMax", () => {
  it("is the UTF-8 size of the prompt rank sends, so it bounds the input tokens", async () => {
    const withAccent = { relationship: "father", facts: ["wants: a mug"], options: [{ id: "c1", title: "Café mug", totalCents: 1500, fit: "within" as const }] };
    const { h, fetch } = http(() => messagesReply(JSON.stringify({ order: [] })));
    await rank(h, withAccent, { maxTokens: 800, ...keep, prices, signal });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const bytes = new TextEncoder().encode(body.system + body.messages[0].content).length;
    expect(rankInputTokensMax(withAccent, keep)).toBe(bytes);
    expect(bytes).toBeGreaterThan((body.system + body.messages[0].content).length);
  });
});

describe("rankWorstCents", () => {
  it("is input plus maxTokens at the output price", () => {
    expect(rankWorstCents(prices, 800, 2000)).toBeCloseTo(2000 * 0.001 + 800 * 0.005);
  });
});

describe("gatewayPrices", () => {
  const listing = {
    data: [
      { id: "other/model", pricing: { input: "0.1", output: "0.1", web_search: "1" } },
      { id: "anthropic/claude-sonnet-5.5", pricing: { input: "0.000003", output: "0.000015", web_search: "0.01" } },
      { id: "no/pricing" },
    ],
  };
  it("converts dollars to cents, and per 1,000 searches to per search", async () => {
    const { h, fetch } = http(() => new Response(JSON.stringify(listing)));
    const p = await gatewayPrices(h, "anthropic/claude-sonnet-5.5", signal);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://gw.test/v1/models");
    expect(p.inputCentsPerToken).toBeCloseTo(0.0003);
    expect(p.outputCentsPerToken).toBeCloseTo(0.0015);
    expect(p.searchCents).toBeCloseTo(0.001);
  });
  it("never reads an empty, null, zero or non-numeric price as free", async () => {
    for (const bad of ["", null, 0, "0", "abc"]) {
      const l = { data: [{ id: "m", pricing: { input: "0.1", output: bad, web_search: "1" } }] };
      const { h } = http(() => new Response(JSON.stringify(l)));
      await expect(gatewayPrices(h, "m", signal)).rejects.toMatchObject({ kind: "unavailable" });
    }
  });
  it("throws unavailable when the model has no pricing", async () => {
    const { h } = http(() => new Response(JSON.stringify(listing)));
    await expect(gatewayPrices(h, "no/pricing", signal)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(gatewayPrices(h, "missing/model", signal)).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("sendMessages", () => {
  it("returns the last text block", async () => {
    const { h } = http(() => messagesReply("last"));
    expect((await sendMessages(h, {}, prices, signal)).text).toBe("last");
  });
});
