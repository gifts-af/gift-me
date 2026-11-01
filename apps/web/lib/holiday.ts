import { cacheLife } from "next/cache";

// When the logo wears its Christmas hat (ALL-48). The window is a setting,
// `HOLIDAY_LOGO_DATES` as "MM-DD..MM-DD" (e.g. "11-01..12-26"); a window may
// cross New Year. Unset or badly formed means the plain logo.

// Days turn over on US Eastern time, where the owners live.
const TIME_ZONE = "America/New_York";

const WINDOW = /^(\d{2})-(\d{2})\.\.(\d{2})-(\d{2})$/;

function monthDay(month: string, day: string) {
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${month}-${day}` : null;
}

export function isHolidaySeason(window: string | undefined, now: Date): boolean {
  const match = window ? WINDOW.exec(window) : null;
  if (!match) return false;
  const start = monthDay(match[1], match[2]);
  const end = monthDay(match[3], match[4]);
  if (!start || !end) return false;

  // "en-CA" formats as MM-DD, which compares correctly as text.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, month: "2-digit", day: "2-digit" }).format(now);
  return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

export function holidayLogoOn(now = new Date()) {
  return isHolidaySeason(process.env.HOLIDAY_LOGO_DATES, now);
}

// For server code that renders ahead of time (the root layout, the icons).
// With Cache Components, reading the clock needs a cache scope; "hours"
// re-checks within the hour, so the hat comes and goes on its own.
export async function holidayLogoNow() {
  "use cache";
  cacheLife("hours");
  return holidayLogoOn();
}
