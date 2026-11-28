import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarDate, Database } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";

export type SeasonSetting = { name: string; start: CalendarDate; end: CalendarDate };

const KEYS = { name: "share_season_name", start: "share_season_start", end: "share_season_end" } as const;

/**
 * The season's name while it's on, or null. On from `start` up to the day before `end`, so
 * setting `end` to a past date turns it off (E7). Dates are YYYY-MM-DD, which compare as text.
 */
export function seasonOn(s: SeasonSetting, today: CalendarDate): string | null {
  const name = s.name.trim();
  return name && s.start <= today && today < s.end ? name : null;
}

/**
 * The season shared lists lead with, from app_settings (T23). Read with the service role,
 * because a signed-out visitor can't read settings. A missing or unreadable setting is logged
 * and reads as out of season, so the share page shows its everyday wording rather than failing.
 */
export async function shareSeason(db: SupabaseClient<Database>, today: CalendarDate): Promise<string | null> {
  const { data, error } = await db
    .schema("concierge")
    .from("app_settings")
    .select("key, value")
    .in("key", Object.values(KEYS));
  const value = (key: string) => {
    const v = data?.find((row) => row.key === key)?.value;
    return typeof v === "string" ? v : null;
  };
  const [name, start, end] = [value(KEYS.name), value(KEYS.start), value(KEYS.end)];
  if (error || name === null || start === null || end === null) {
    logEvent("share_season.unreadable", error ? errorFields(error) : { missing: true });
    return null;
  }
  return seasonOn({ name, start, end }, today);
}
