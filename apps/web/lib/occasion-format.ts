import { addDays, parseDate, type CalendarDate, type OccasionKind } from "@gifts-af/core";

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

/** "Mar 14": a birthday or anniversary, which has no year. */
export function monthDay(d: { month: number; day: number }): string {
  return `${MONTHS[d.month - 1]} ${d.day}`;
}

/** "Sat, Mar 14" from a calendar date, with no time zone involved. */
export function shortDate(date: string): string {
  const { year, month, day } = parseDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${MONTHS[month - 1]} ${day}`;
}

/** The last day to choose: the day before the ship-by day, since buying is refused from that day on. */
export const chooseBy = (shipBy: CalendarDate) => shortDate(addDays(shipBy, -1));
