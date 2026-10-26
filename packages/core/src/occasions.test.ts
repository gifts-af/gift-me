import { describe, expect, it } from "vitest";
import { nextOccurrence, occasionDateInYear, type OccasionRule } from "./occasions";

const christmas: OccasionRule = { kind: "christmas" };
const leapBirthday: OccasionRule = { kind: "birthday", month: 2, day: 29 };

describe("occasion dates", () => {
  it("puts Mother's Day on the 2nd Sunday of May", () => {
    expect(occasionDateInYear({ kind: "mothers_day" }, 2026)).toBe("2026-05-10");
    expect(occasionDateInYear({ kind: "mothers_day" }, 2027)).toBe("2027-05-09");
  });

  it("puts Father's Day on the 3rd Sunday of June", () => {
    expect(occasionDateInYear({ kind: "fathers_day" }, 2026)).toBe("2026-06-21");
    // June 2025 starts on a Sunday, so the 3rd Sunday is the 15th.
    expect(occasionDateInYear({ kind: "fathers_day" }, 2025)).toBe("2025-06-15");
  });

  it("has fixed dates for Christmas and Valentine's Day", () => {
    expect(occasionDateInYear(christmas, 2026)).toBe("2026-12-25");
    expect(occasionDateInYear({ kind: "valentines_day" }, 2027)).toBe("2027-02-14");
  });

  it("uses the month and day for birthdays and anniversaries", () => {
    expect(occasionDateInYear({ kind: "anniversary", month: 6, day: 30 }, 2027)).toBe("2027-06-30");
  });

  it("moves a Feb 29 birthday to Feb 28 in years without a leap day", () => {
    expect(occasionDateInYear(leapBirthday, 2027)).toBe("2027-02-28");
    expect(occasionDateInYear(leapBirthday, 2028)).toBe("2028-02-29");
  });

  it("counts today as the next occurrence", () => {
    expect(nextOccurrence(christmas, "2026-12-25")).toBe("2026-12-25");
  });

  it("rolls over to next year once the date has passed", () => {
    expect(nextOccurrence(christmas, "2026-12-26")).toBe("2027-12-25");
    expect(nextOccurrence(leapBirthday, "2027-03-01")).toBe("2028-02-29");
  });

  it("rejects a birthday that can never happen", () => {
    expect(() => occasionDateInYear({ kind: "birthday", month: 13, day: 1 }, 2026)).toThrow(RangeError);
    expect(() => occasionDateInYear({ kind: "birthday", month: 4, day: 31 }, 2026)).toThrow(RangeError);
  });
});
