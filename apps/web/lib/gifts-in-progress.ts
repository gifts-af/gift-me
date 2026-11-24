import "server-only";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { errorFields, logEvent } from "@/lib/log";
import { giftsInProgress, type GiftInProgress } from "@/modules/concierge";

/**
 * The signed-in user's gifts in progress, or one person's. Extra on both pages that show it, so a
 * failed read (or a missing setting) is logged and shows nothing rather than taking the page down (T19).
 */
export async function loadGiftsInProgress(personId?: string): Promise<GiftInProgress[]> {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    userId = (await supabase.auth.getClaims()).data?.claims?.sub ?? null;
    if (!userId) return [];
    const leaveAfterDays = await appSettingInt("gift_progress_days", supabase as unknown as SupabaseClient<Database>);
    return await giftsInProgress(supabase as unknown as SupabaseClient<Database>, { now: new Date(), leaveAfterDays, personId });
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure.
    logEvent("gifts_in_progress_failed", {
      user_id: userId,
      ...(personId ? { person_id: personId } : {}),
      error: error instanceof Error ? error.name : "unknown",
      ...errorFields(error),
    });
    return [];
  }
}
