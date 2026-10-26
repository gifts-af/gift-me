import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDates,
  dayOfWeek,
  daysBetween,
  isLeapYear,
  maxDate,
  minDate,
  parseDate,
  toDate,
} from "./dates";

describe("calendar dates", () => {
  it("adds days across a year boundary", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("subtracts days into a leap day", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("counts the days between two dates", () => {
    expect(daysBetween("2026-10-25", "2026-12-25")).toBe(61);
    expect(daysBetween("2026-12-25", "2026-10-25")).toBe(-61);
  });

  it("knows which years are leap years", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("gives the day of the week, Sunday first", () => {
    expect(dayOfWeek("2026-10-25")).toBe(0);
    expect(dayOfWeek("2026-10-31")).toBe(6);
  });

  it("compares and picks dates", () => {
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareDates("2026-01-02", "2026-01-02")).toBe(0);
    expect(compareDates("2026-01-03", "2026-01-02")).toBe(1);
    expect(minDate("2026-05-01", "2026-04-30")).toBe("2026-04-30");
    expect(maxDate("2026-05-01", "2026-04-30")).toBe("2026-05-01");
  });

  it("parses and builds dates", () => {
    expect(parseDate("2026-02-03")).toEqual({ year: 2026, month: 2, day: 3 });
    expect(toDate(2026, 2, 3)).toBe("2026-02-03");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => parseDate("2026-02-30")).toThrow(RangeError);
    expect(() => parseDate("2026-2-3")).toThrow(RangeError);
    expect(() => parseDate("2026-02-03T00:00")).toThrow(RangeError);
    expect(() => toDate(2027, 2, 29)).toThrow(RangeError);
    expect(() => toDate(2026, 13, 1)).toThrow(RangeError);
    expect(() => addDays("2026-01-01", 1.5)).toThrow(RangeError);
  });
});
