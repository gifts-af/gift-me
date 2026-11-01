import { describe, expect, it } from "vitest";
import { nextOccasion, relationshipLabel, RELATIONSHIPS, startingOccasions } from "./people";

const none = { birthday: false, anniversary: false };

describe("relationships", () => {
  it("lists them in order", () => {
    expect(RELATIONSHIPS).toEqual([
      "mother", "father", "wife", "husband", "girlfriend", "boyfriend", "partner", "son",
      "daughter", "grandmother", "grandfather", "sister", "brother", "best_friend", "friend", "other",
    ]);
  });

  it("labels them for people", () => {
    expect(relationshipLabel("mother")).toBe("Mother");
    expect(relationshipLabel("best_friend")).toBe("Best friend");
    expect(RELATIONSHIPS.map(relationshipLabel).every((l) => /^[A-Z][a-z ]+$/.test(l))).toBe(true);
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
  it("gives a wife everything when both dates are given", () => {
    expect(startingOccasions("wife", { birthday: true, anniversary: true }).sort()).toEqual(
      ["anniversary", "birthday", "christmas", "valentines_day"].sort(),
    );
  });
  it("skips the anniversary for a wife without one", () => {
    expect(startingOccasions("husband", none)).toEqual(["christmas", "valentines_day"]);
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
  it("throws on a birthday without a date", () => {
    expect(() => nextOccasion([{ kind: "birthday", month: null, day: null, enabled: true }], "2026-01-01")).toThrow();
  });
});
