// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, type ExtractInput } from "../extract";

// The model is a vendor we don't own, so it's mocked (E5).
function modelReturning(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
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
};

const vise = { category: "wants", value: "a new rotary fly-tying vise", confidence: 0.9, evidence: "gave out" };

/** Everything the model was sent, as one string. */
function sent(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls[0].prompt);
}

describe("createExtractor", () => {
  it("returns the model's facts without the evidence", async () => {
    const model = modelReturning({ facts: [vise] });
    const facts = await createExtractor(model)(input);
    expect(facts).toEqual([{ category: "wants", value: "a new rotary fly-tying vise", confidence: 0.9 }]);
  });

  it("returns an empty list when the model finds nothing", async () => {
    const facts = await createExtractor(modelReturning({ facts: [] }))(input);
    expect(facts).toEqual([]);
  });

  it("describes the person by relationship only", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input);
    expect(sent(model)).toContain("their father");
    expect(sent(model)).not.toMatch(/name/i);
  });

  it("tells the model that something only seen is owned, and never to pad the list", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input);
    const system = model.doGenerateCalls[0].prompt.find((m) => m.role === "system")?.content;
    expect(system).toMatch(/seen with, using or wearing is "owns"/);
    expect(system).toMatch(/return an empty list/i);
  });

  it("sends the screenshot as an image when there is one", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, screenshot: new Uint8Array([1, 2, 3]) });
    const user = model.doGenerateCalls[0].prompt.find((m) => m.role === "user");
    expect(JSON.stringify(user)).toContain("image/jpeg");
  });

  it("sends no image when there is no screenshot", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)(input);
    expect(sent(model)).not.toContain("image/jpeg");
  });

  it("labels the buyer's note as theirs", async () => {
    const model = modelReturning({ facts: [] });
    await createExtractor(model)({ ...input, note: "He said this broke" });
    expect(sent(model)).toContain("Note from the person who captured this: He said this broke");
  });

  it.each([
    ["an unknown category", { ...vise, category: "mood" }],
    ["confidence above 1", { ...vise, confidence: 1.5 }],
    ["an empty value", { ...vise, value: "" }],
    ["a value over 200 characters", { ...vise, value: "x".repeat(201) }],
  ])("rejects output with %s", async (_label, fact) => {
    await expect(createExtractor(modelReturning({ facts: [fact] }))(input)).rejects.toThrow();
  });
});
