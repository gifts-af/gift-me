import "server-only";
import { headers } from "next/headers";
import { toDate, type CalendarDate } from "@gifts-af/core";
import { createClient } from "@/lib/supabase/server";

function dayIn(timeZone: string, now: Date): CalendarDate | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(now);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return toDate(part("year"), part("month"), part("day"));
  } catch {
    return null; // not a real time zone
  }
}

/**
 * The buyer's calendar day: in their profile time zone; when that is empty,
 * in the request's zone (Vercel's x-vercel-ip-timezone header); otherwise UTC.
 */
export function resolveToday(o: {
  profileTimezone: string | null;
  headerTimezone: string | null;
  now: Date;
}): CalendarDate {
  for (const zone of [o.profileTimezone, o.headerTimezone]) {
    if (zone) {
      const day = dayIn(zone, o.now);
      if (day) return day;
    }
  }
  return dayIn("UTC", o.now) as CalendarDate;
}

/** "Today" for the current request. */
export async function todayForRequest(): Promise<CalendarDate> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  let profileTimezone: string | null = null;
  if (userId) {
    const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    profileTimezone = data?.timezone ?? null;
  }
  const requestHeaders = await headers();
  return resolveToday({
    profileTimezone,
    headerTimezone: requestHeaders.get("x-vercel-ip-timezone"),
    now: new Date(),
  });
}
