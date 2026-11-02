import { describe, expect, it } from "vitest";
import { FACT_CATEGORIES_EXTRACTED, factLine } from "./facts";

describe("factLine", () => {
  it.each([
    ["owns", "Already has: Owala water bottle"],
    ["wants", "Wants: Owala water bottle"],
    ["interest", "Into: Owala water bottle"],
    ["dislike", "Dislikes: Owala water bottle"],
    ["size", "Size: Owala water bottle"],
    ["brand", "Likes the brand: Owala water bottle"],
    ["style", "Style: Owala water bottle"],
    ["avoid", "Avoid: Owala water bottle"],
    ["constraint", "Needs: Owala water bottle"],
    ["loved", "Loved: Owala water bottle"],
  ] as const)("labels %s", (category, line) => {
    expect(factLine(category, "Owala water bottle")).toBe(line);
  });
});

describe("FACT_CATEGORIES_EXTRACTED", () => {
  it("is every category except loved, which only reactions set", () => {
    expect(FACT_CATEGORIES_EXTRACTED).toEqual([
      "interest", "dislike", "size", "brand", "owns", "wants", "style", "avoid", "constraint",
    ]);
  });
});
