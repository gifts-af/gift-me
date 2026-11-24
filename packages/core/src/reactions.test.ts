import { describe, expect, it } from "vitest";
import { FACT_VALUE_MAX } from "./approval";
import { RATINGS, RATING_LABELS, reactionFact } from "./reactions";

const ai = (title: string) => ({ title, fromList: false });

describe("RATING_LABELS", () => {
  it("names every rating, best first", () => {
    expect(RATINGS.map((r) => RATING_LABELS[r])).toEqual(["Loved it", "Liked it", "Meh", "Returned it"]);
  });
});

describe("reactionFact", () => {
  it("without a note: loved and meh teach something; liked and returned don't", () => {
    expect(reactionFact("loved", ai("Vase"), null)).toEqual({ category: "loved", value: "Vase" });
    expect(reactionFact("liked", ai("Vase"), null)).toBeNull();
    expect(reactionFact("meh", ai("Vase"), null)).toEqual({ category: "avoid", value: "Didn't love: Vase" });
    expect(reactionFact("returned", ai("Vase"), null)).toBeNull();
  });

  it("with a note: every rating but liked keeps it", () => {
    expect(reactionFact("loved", ai("Vase"), "so blue")).toEqual({ category: "loved", value: "Vase: so blue" });
    expect(reactionFact("liked", ai("Vase"), "so blue")).toBeNull();
    expect(reactionFact("meh", ai("Vase"), "too big")).toEqual({ category: "avoid", value: "Didn't love: Vase: too big" });
    expect(reactionFact("returned", ai("Vase"), "too big")).toEqual({ category: "avoid", value: "Returned Vase: too big" });
  });

  it("a whitespace-only note counts as none", () => {
    expect(reactionFact("loved", ai("Vase"), " \n\t ")).toEqual({ category: "loved", value: "Vase" });
    expect(reactionFact("meh", ai("Vase"), "  ")).toEqual({ category: "avoid", value: "Didn't love: Vase" });
    expect(reactionFact("returned", ai("Vase"), "  ")).toBeNull();
  });

  it("trims the title and the note", () => {
    expect(reactionFact("loved", ai("  Vase "), " so blue\n")).toEqual({ category: "loved", value: "Vase: so blue" });
  });

  it("a blank title is never a fact", () => {
    for (const rating of RATINGS) expect(reactionFact(rating, ai("  "), "note")).toBeNull();
  });

  it("a list gift is never a fact, with or without a note (AC-17)", () => {
    for (const rating of RATINGS) {
      expect(reactionFact(rating, { title: "Vase", fromList: true }, null)).toBeNull();
      expect(reactionFact(rating, { title: "Vase", fromList: true }, "note")).toBeNull();
    }
  });

  it("cuts a long title or note to the facts limit", () => {
    expect(reactionFact("loved", ai("t".repeat(600)), null)?.value).toBe("t".repeat(FACT_VALUE_MAX));
    expect(reactionFact("returned", ai("Vase"), "n".repeat(600))?.value).toBe(
      "Returned Vase: " + "n".repeat(FACT_VALUE_MAX - "Returned Vase: ".length),
    );
    expect(Array.from(reactionFact("loved", ai("🎁".repeat(600)), null)?.value ?? "")).toHaveLength(FACT_VALUE_MAX);
  });

  it("leaves no trailing space where it cut", () => {
    expect(reactionFact("loved", ai("t".repeat(FACT_VALUE_MAX - 1) + " more"), null)?.value).toBe("t".repeat(FACT_VALUE_MAX - 1));
  });
});
