"use server";

import { createClient } from "@/lib/supabase/server";
import { saveConciergeSettings, type SaveResult } from "@/modules/concierge";

// Time zone lives on the shared profile; the over-budget allowance is the
// concierge's (T26).
export async function saveSettings(_previous: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const timezone = String(formData.get("timezone") ?? "");
  if (!Intl.supportedValuesOf("timeZone").includes(timezone)) {
    return { ok: false, error: "Pick a time zone from the list." };
  }

  const concierge = await saveConciergeSettings({ overBudgetPct: String(formData.get("overBudgetPct") ?? "") });
  if (!concierge.ok) return concierge;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", userId);
  if (error) {
    console.error("saving the time zone failed", error);
    return { ok: false, error: "Your settings couldn't be saved. Try again." };
  }
  return { ok: true };
}
