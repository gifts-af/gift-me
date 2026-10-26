// Plain calendar dates ("YYYY-MM-DD"), with no time of day or time zone, so
// a time zone can never move an occasion by a day. The math uses UTC
// internally and never local time.

export type CalendarDate = string;

const DAY_MS = 86_400_000;
const FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toDate(year: number, month: number, day: number): CalendarDate {
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    year < 1 || year > 9999 || month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month)
  ) {
    throw new RangeError(`Not a real date: ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDate(s: string): { year: number; month: number; day: number } {
  const m = FORMAT.exec(s);
  if (!m) throw new RangeError(`Expected a YYYY-MM-DD date, got "${s}"`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  toDate(year, month, day); // throws on an impossible date like 2026-02-30
  return { year, month, day };
}

function toEpochDays(d: CalendarDate): number {
  const { year, month, day } = parseDate(d);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromEpochDays(days: number): CalendarDate {
  const date = new Date(days * DAY_MS);
  return toDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(d: CalendarDate, n: number): CalendarDate {
  if (!Number.isInteger(n)) throw new RangeError(`Days must be a whole number, got ${n}`);
  return fromEpochDays(toEpochDays(d) + n);
}

/** `to − from`, in days. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toEpochDays(to) - toEpochDays(from);
}

export function compareDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  const diff = daysBetween(b, a);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

export function minDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareDates(a, b) <= 0 ? a : b;
}

export function maxDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareDates(a, b) >= 0 ? a : b;
}

/** 0 is Sunday. */
export function dayOfWeek(d: CalendarDate): number {
  return new Date(toEpochDays(d) * DAY_MS).getUTCDay();
}
