import { describe, expect, it } from "vitest";
import type { FactCategory } from "./facts";
import {
  CATEGORY_GROUPS,
  GUIDED_QUESTIONS,
  factSourceLabel,
  nextStep,
  openQuestions,
  readinessLabel,
  readinessScore,
  splitAnswer,
} from "./profile";

const settings = {
  points: { interests: 30, wants: 20, avoid: 15, sizes: 15, brands: 10, owns: 10 },
  ownList: 40,
};

const keys = (qs: { key: string }[]) => qs.map((q) => q.key);

describe("openQuestions", () => {
  it("asks a new person the first ones, most useful first", () => {
    expect(keys(openQuestions([], [], 5))).toEqual(["interests", "wants", "avoid", "sizes", "brands"]);
  });

  it("asks nothing when switched off", () => {
    expect(openQuestions([], [], 0)).toEqual([]);
  });

  it("closes a question when any of its categories has a fact", () => {
    expect(keys(openQuestions(["loved"], [], 2))).toEqual(["wants", "avoid"]);
    expect(keys(openQuestions(["dislike", "constraint"], [], 2))).toEqual(["interests", "wants"]);
    expect(keys(openQuestions(["style"], [], 6))).not.toContain("brands");
  });

  it("never re-asks a skipped question, and the next one takes its place", () => {
    expect(keys(openQuestions([], ["wants"], 5))).toEqual(["interests", "avoid", "sizes", "brands", "owns"]);
  });

  it("is empty when every gap is filled", () => {
    const all: FactCategory[] = ["interest", "wants", "avoid", "size", "brand", "owns"];
    expect(openQuestions(all, [], 5)).toEqual([]);
  });

  it("ignores a skipped key this build doesn't know", () => {
    expect(keys(openQuestions([], ["gone"], 1))).toEqual(["interests"]);
  });
});

describe("guided question wording", () => {
  it("keeps names out, so a stored prompt holds no personal data", () => {
    for (const q of GUIDED_QUESTIONS) {
      expect(q.prompt).toMatch(/they|their|them/i);
      expect(q.categories[0]).toBe(q.category);
    }
  });
});

describe("splitAnswer", () => {
  it("splits on commas and new lines, trims, and drops repeats", () => {
    expect(splitAnswer("fly fishing, crime podcasts\n Fly  Fishing ,, ")).toEqual(["fly fishing", "crime podcasts"]);
  });

  it("gives nothing for a blank answer", () => {
    expect(splitAnswer("  \n , ")).toEqual([]);
  });

  it("collapses inner spacing", () => {
    expect(splitAnswer("shirt   L")).toEqual(["shirt L"]);
  });
});

describe("readinessScore", () => {
  it("is 0 with nothing known", () => {
    expect(readinessScore([], false, settings)).toBe(0);
  });

  it("adds a gap's points once, however many facts fill it", () => {
    expect(readinessScore(["interest"], false, settings)).toBe(30);
    expect(readinessScore(["interest", "loved"], false, settings)).toBe(30);
    expect(readinessScore(["interest", "wants", "size"], false, settings)).toBe(65);
  });

  it("gives credit for keeping their own list", () => {
    expect(readinessScore([], true, settings)).toBe(40);
  });

  it("caps at 100", () => {
    const all: FactCategory[] = ["interest", "wants", "avoid", "size", "brand", "owns"];
    expect(readinessScore(all, true, settings)).toBe(100);
  });
});

describe("readinessLabel", () => {
  it.each([
    [0, "Just starting"],
    [1, "Getting there"],
    [59, "Getting there"],
    [60, "Good to go"],
    [100, "Good to go"],
  ])("%i reads %s", (score, label) => {
    expect(readinessLabel(score, 60)).toBe(label);
  });
});

describe("nextStep", () => {
  it("offers questions first, even when ready", () => {
    expect(nextStep(3, 0, 60)).toEqual({ kind: "answer", count: 3 });
    expect(nextStep(1, 90, 60)).toEqual({ kind: "answer", count: 1 });
  });

  it("suggests a capture when no questions are left and it isn't ready", () => {
    expect(nextStep(0, 30, 60)).toEqual({ kind: "capture" });
  });

  it("asks nothing when ready with no questions", () => {
    expect(nextStep(0, 60, 60)).toEqual({ kind: "none" });
  });
});

describe("CATEGORY_GROUPS", () => {
  it("names every category once", () => {
    const every: FactCategory[] = [
      "interest", "dislike", "size", "brand", "owns", "wants", "style", "avoid", "constraint", "loved",
    ];
    expect(CATEGORY_GROUPS.map((g) => g.category).sort()).toEqual([...every].sort());
  });
});

describe("factSourceLabel", () => {
  it.each([
    ["capture", false, "✨ AI suggestion"],
    ["capture", true, "From a capture"],
    ["question", true, "You answered"],
    ["note", false, "You told us"],
    ["reaction", true, "From their reaction"],
    ["rejection", true, "From an idea you passed on"],
    ["inbound", false, "From your email"],
  ])("%s, confirmed %s reads %s", (source, confirmed, label) => {
    expect(factSourceLabel(source, confirmed)).toBe(label);
  });
});
