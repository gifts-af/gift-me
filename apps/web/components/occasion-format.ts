import { parseDate, type OccasionKind } from "@gifts-af/core";

export const OCCASION_NAMES: Record<OccasionKind, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  christmas: "Christmas",
  valentines_day: "Valentine's Day",
  mothers_day: "Mother's Day",
  fathers_day: "Father's Day",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat, Mar 14" from a calendar date, with no time zone involved. */
export function shortDate(date: string): string {
  const { year, month, day } = parseDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${MONTHS[month - 1]} ${day}`;
}
