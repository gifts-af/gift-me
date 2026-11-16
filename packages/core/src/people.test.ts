import { describe, expect, it } from "vitest";
import { nextOccasion, relationshipLabel, RELATIONSHIPS, startingOccasions } from "./people";

const none = { birthday: false, anniversary: false };

describe("relationships", () => {
  // Alphabetical by label so a long list is easy to scan, with Other last (owner, 2026-11-16).
  it("lists them alphabetically, Other last", () => {
    expect(RELATIONSHIPS).toEqual([
      "aunt", "best_friend", "boyfriend", "brother", "brother_in_law", "daughter", "daughter_in_law",
      "father", "father_in_law", "friend", "girlfriend", "grandfather", "grandmother", "husband",
      "mother", "mother_in_law", "partner", "sister", "sister_in_law", "son", "son_in_law", "uncle",
      "wife", "other",
    ]);
    const labels = RELATIONSHIPS.slice(0, -1).map(relationshipLabel);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("has Aunt and Uncle, which start with Christmas only", () => {
    expect(relationshipLabel("aunt")).toBe("Aunt");
    expect(relationshipLabel("uncle")).toBe("Uncle");
    expect(startingOccasions("aunt", none)).toEqual(["christmas"]);
    expect(startingOccasions("uncle", none)).toEqual(["christmas"]);
  });

  it("labels an unknown stored value as Other", () => {
    expect(relationshipLabel("parent")).toBe("Other");
    expect(relationshipLabel("")).toBe("Other");
  });

  it("labels them for people", () => {
    expect(relationshipLabel("mother")).toBe("Mother");
    expect(relationshipLabel("best_friend")).toBe("Best friend");
    expect(RELATIONSHIPS.map(relationshipLabel).every((l) => /^[A-Z][a-z -]+$/.test(l))).toBe(true);
  });

  // ALL-121: in-laws read with hyphens.
  it("labels the in-laws with hyphens", () => {
    expect(relationshipLabel("mother_in_law")).toBe("Mother-in-law");
    expect(relationshipLabel("father_in_law")).toBe("Father-in-law");
    expect(relationshipLabel("sister_in_law")).toBe("Sister-in-law");
    expect(relationshipLabel("brother_in_law")).toBe("Brother-in-law");
    expect(relationshipLabel("daughter_in_law")).toBe("Daughter-in-law");
    expect(relationshipLabel("son_in_law")).toBe("Son-in-law");
  });
});

describe("startingOccasions", () => {
  it("gives a mother Christmas and Mother's Day", () => {
    expect(startingOccasions("mother", none)).toEqual(["christmas", "mothers_day"]);
  });
  it("gives a grandmother Mother's Day", () => {
    expect(startingOccasions("grandmother", none)).toEqual(["christmas", "mothers_day"]);
  });
  it("gives a father and grandfather Father's Day", () => {
    expect(startingOccasions("father", none)).toEqual(["christmas", "fathers_day"]);
    expect(startingOccasions("grandfather", none)).toEqual(["christmas", "fathers_day"]);
  });
  // ALL-121 [Claude's call]: in-law parents start with Mother's and Father's Day.
  it("gives a mother-in-law Mother's Day and a father-in-law Father's Day", () => {
    expect(startingOccasions("mother_in_law", none)).toEqual(["christmas", "mothers_day"]);
    expect(startingOccasions("father_in_law", none)).toEqual(["christmas", "fathers_day"]);
  });
  it("gives other in-laws just Christmas and a birthday", () => {
    expect(startingOccasions("sister_in_law", { birthday: true, anniversary: false })).toEqual(["christmas", "birthday"]);
  });
  it("gives a wife everything when both dates are given", () => {
    expect(startingOccasions("wife", { birthday: true, anniversary: true }).sort()).toEqual(
      ["anniversary", "birthday", "christmas", "valentines_day"].sort(),
    );
  });
  it("skips the anniversary for a husband without one", () => {
    expect(startingOccasions("husband", none)).toEqual(["christmas", "valentines_day"]);
  });
  it("gives a wife or husband with only an anniversary no birthday", () => {
    for (const r of ["wife", "husband"] as const) {
      expect(startingOccasions(r, { birthday: false, anniversary: true }).sort()).toEqual(
        ["anniversary", "christmas", "valentines_day"].sort(),
      );
    }
  });
  it("gives everyone else only Christmas", () => {
    for (const r of ["daughter", "sister", "brother", "best_friend", "friend", "other"] as const) {
      expect(startingOccasions(r, none)).toEqual(["christmas"]);
    }
  });
  it("gives Valentine's Day to partners", () => {
    for (const r of ["girlfriend", "boyfriend", "partner"] as const) {
      expect(startingOccasions(r, none)).toContain("valentines_day");
    }
  });
  it("gives a girlfriend no anniversary", () => {
    expect(startingOccasions("girlfriend", { birthday: true, anniversary: true })).not.toContain("anniversary");
  });
  it("gives a son only Christmas", () => {
    expect(startingOccasions("son", none)).toEqual(["christmas"]);
  });
});

describe("nextOccasion", () => {
  const rows = [
    { kind: "christmas" as const, month: null, day: null, enabled: true },
    { kind: "birthday" as const, month: 3, day: 14, enabled: true },
  ];
  it("picks the birthday before it", () => {
    expect(nextOccasion(rows, "2026-03-01")).toEqual({ kind: "birthday", date: "2026-03-14" });
  });
  it("counts today", () => {
    expect(nextOccasion(rows, "2026-03-14")).toEqual({ kind: "birthday", date: "2026-03-14" });
  });
  it("moves on after the birthday", () => {
    expect(nextOccasion(rows, "2026-03-15")).toEqual({ kind: "christmas", date: "2026-12-25" });
  });
  it("puts a Feb 29 birthday on Feb 28 in other years", () => {
    const feb = [{ kind: "birthday" as const, month: 2, day: 29, enabled: true }];
    expect(nextOccasion(feb, "2027-02-01")).toEqual({ kind: "birthday", date: "2027-02-28" });
  });
  it("gives ties to list order", () => {
    const tie = [
      { kind: "birthday" as const, month: 12, day: 25, enabled: true },
      { kind: "christmas" as const, month: null, day: null, enabled: true },
    ];
    expect(nextOccasion(tie, "2026-12-01")?.kind).toBe("birthday");
  });
  it("ignores disabled occasions, and returns null when none are enabled", () => {
    expect(nextOccasion(rows.map((r) => ({ ...r, enabled: false })), "2026-03-01")).toBeNull();
    expect(nextOccasion([], "2026-03-01")).toBeNull();
  });
  it("falls to Christmas when the birthday is disabled", () => {
    const off = [{ ...rows[1]!, enabled: false }, rows[0]!];
    expect(nextOccasion([off[0]!, off[1]!], "2026-03-01")).toEqual({ kind: "christmas", date: "2026-12-25" });
  });
  it("throws on a birthday without a date", () => {
    expect(() => nextOccasion([{ kind: "birthday", month: null, day: null, enabled: true }], "2026-01-01")).toThrow();
  });
});
