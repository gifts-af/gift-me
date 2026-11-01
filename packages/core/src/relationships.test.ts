import { describe, expect, it } from "vitest";
import { RELATIONSHIPS } from "./relationships";

describe("relationship list", () => {
  it("lists the relationship values in order", () => {
    expect(RELATIONSHIPS.map((r) => r.value)).toEqual([
      "parent",
      "partner",
      "child",
      "sibling",
      "friend",
      "other",
    ]);
  });

  it("gives every relationship a non-empty display label", () => {
    for (const relationship of RELATIONSHIPS) {
      expect(typeof relationship.label).toBe("string");
      expect(relationship.label.length).toBeGreaterThan(0);
    }
  });
});
