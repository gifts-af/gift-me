"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  createSupabaseNotifyStore,
  defaultChannels,
  saveConciergeSettings,
  sendTestNotification,
  type SaveResult,
} from "@/modules/concierge";

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

// Sends the signed-in user a real notification email, so they can see what
// reminders will look like and that the links work.
export async function sendTestEmail(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  const failed = { ok: false, error: "We couldn't send it. Try again in a minute." } as const;
  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host) return failed;
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    const result = await sendTestNotification(userId, {
      store: createSupabaseNotifyStore(),
      channels: defaultChannels(),
      baseUrl: `${proto}://${host}`,
      now: new Date(),
    });
    return result.ok ? { ok: true } : failed;
  } catch (error) {
    console.error("sending the test email failed", error);
    return failed;
  }
}
