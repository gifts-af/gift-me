// When each occasion falls (design §3 `occasions`, PRD P-3). US dates only
// for now.

import { addDays, dayOfWeek, isLeapYear, parseDate, toDate, type CalendarDate } from "./dates";

export type Holiday = "christmas" | "valentines_day" | "mothers_day" | "fathers_day";

/** Matches the database's `occasions.kind`. */
export type OccasionKind = Holiday | "birthday" | "anniversary";

export type OccasionRule =
  | { kind: Holiday }
  | { kind: "birthday" | "anniversary"; month: number; day: number };

/** The Nth Sunday of a month: the first Sunday on or after day 1 + 7(N − 1). */
function nthSunday(year: number, month: number, n: number): CalendarDate {
  const earliest = toDate(year, month, 1 + 7 * (n - 1));
  return addDays(earliest, (7 - dayOfWeek(earliest)) % 7);
}

export function occasionDateInYear(rule: OccasionRule, year: number): CalendarDate {
  switch (rule.kind) {
    case "christmas":
      return toDate(year, 12, 25);
    case "valentines_day":
      return toDate(year, 2, 14);
    case "mothers_day":
      return nthSunday(year, 5, 2);
    case "fathers_day":
      return nthSunday(year, 6, 3);
    case "birthday":
    case "anniversary": {
      // Check the date against a leap year, so Feb 29 is allowed but Apr 31 isn't.
      toDate(2000, rule.month, rule.day);
      // A Feb 29 date falls on Feb 28 in other years: early beats late.
      if (rule.month === 2 && rule.day === 29 && !isLeapYear(year)) return toDate(year, 2, 28);
      return toDate(year, rule.month, rule.day);
    }
  }
}

/** The next time the occasion happens, counting `onOrAfter` itself. */
export function nextOccurrence(rule: OccasionRule, onOrAfter: CalendarDate): CalendarDate {
  const { year } = parseDate(onOrAfter);
  const thisYear = occasionDateInYear(rule, year);
  return thisYear >= onOrAfter ? thisYear : occasionDateInYear(rule, year + 1);
}
