import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { CalendarDate, Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorFields, logEvent } from "@/lib/log";
import { settingInt } from "@/lib/wiring";

/**
 * Whether the buyer can say how a round's gifts went: the switch is on and the occasion's UTC day
 * has come. It only decides whether a link shows, so any failure (a database older than the switch)
 * is a no. The save checks again.
 */
export async function reactionsOpen(db: unknown, occasionDate: CalendarDate, now: Date): Promise<boolean> {
  return now.toISOString().slice(0, 10) >= occasionDate && (await reactionsEnabled(db));
}

export async function reactionsEnabled(db: unknown): Promise<boolean> {
  try {
    return (await settingInt(db as SupabaseClient<Database>, "reactions_enabled")) === 1;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("reaction.switch_unread", errorFields(error));
    return false;
  }
}
