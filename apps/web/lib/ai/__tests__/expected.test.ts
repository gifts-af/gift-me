// @vitest-environment node
import { describe, expect, it } from "vitest";
import expected from "../fixtures/expected.json";
import recordedScreens from "../fixtures/recorded/screens.json";
import recordedText from "../fixtures/recorded/extract.json";
import { keptForEval, matchesExpected, type Expected } from "../eval";
import type { CandidateFact } from "../extract";

// The recorded Sonnet run from the W1-3 spike is the offline baseline: the
// answer key must pass on it. `pnpm ai:eval` checks the live model the same way.
const key = expected as unknown as Record<string, Expected>;

describe("matchesExpected", () => {
  it("finds a fact by category and keywords, ignoring case", () => {
    const facts: CandidateFact[] = [{ category: "wants", value: "A new Rotary VISE", confidence: 0.9 }];
    expect(matchesExpected(facts, { mustFind: [{ category: ["wants"], keywords: ["rotary", "vise"] }], mustNotFind: [] })).toEqual({
      missing: [],
      forbidden: [],
    });
  });

  it("reports a missing fact and a forbidden word", () => {
    const facts: CandidateFact[] = [{ category: "interest", value: "temple visits", confidence: 0.9 }];
    const result = matchesExpected(facts, { mustFind: [{ category: ["owns"], keywords: ["kettle"] }], mustNotFind: ["temple"] });
    expect(result.missing).toEqual([{ category: ["owns"], keywords: ["kettle"] }]);
    expect(result.forbidden).toEqual(["temple visits"]);
  });
});

describe("keptForEval", () => {
  it("applies the sensitive filter and the 60% cut", () => {
    const facts: CandidateFact[] = [
      { category: "wants", value: "vise", confidence: 0.6 },
      { category: "wants", value: "hooks", confidence: 0.5 },
      { category: "constraint", value: "takes blood pressure meds", confidence: 0.9 },
    ];
    expect(keptForEval(facts, 60).map((f) => f.value)).toEqual(["vise"]);
  });
});

describe("the answer key on the recorded spike run", () => {
  it.each(recordedText.results.map((r) => [r.capture, r.facts] as const))("%s", (id, facts) => {
    const result = matchesExpected(keptForEval(facts as CandidateFact[], 60), key[id]);
    expect(result).toEqual({ missing: [], forbidden: [] });
  });

  it("dad-post-mock.png", () => {
    const facts = recordedScreens.results.find((r) => r.screen === "dad-post-mock.png")!.facts;
    expect(matchesExpected(keptForEval(facts as CandidateFact[], 60), key["dad-post-mock.png"])).toEqual({
      missing: [],
      forbidden: [],
    });
  });
});
