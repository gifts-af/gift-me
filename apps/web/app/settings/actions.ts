"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cancelConnect,
  createSupabaseNotifyStore,
  defaultChannels,
  disconnectZinc,
  pollConnect,
  saveConciergeSettings,
  savePhone,
  sendTestNotification,
  startConnect,
  type PaymentResult,
  type SaveResult,
  type ZincDeps,
} from "@/modules/concierge";
import { baseUrlFrom } from "./base-url";
import { placeHeld, zincWiring } from "./zinc-deps";

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
    const baseUrl = baseUrlFrom(requestHeaders);
    if (!baseUrl) return failed;
    const result = await sendTestNotification(userId, {
      store: createSupabaseNotifyStore(),
      channels: defaultChannels(),
      baseUrl,
      now: new Date(),
    });
    return result.ok ? { ok: true } : failed;
  } catch (error) {
    console.error("sending the test email failed", error);
    return failed;
  }
}

// Paying for gifts (ALL-32). Each action checks who is signed in, builds the Zinc wiring and
// hands both to the module, which re-checks paid features before any Zinc call (AC-1). Results
// are plain data with no keys in them (AC-6); details go to the log as ids only (E6).
async function withZinc(run: (userId: string, deps: ZincDeps) => Promise<PaymentResult>): Promise<PaymentResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { error: "Your session ended. Sign in again." };
  try {
    const wiring = await zincWiring(createAdminClient());
    if (!wiring) return { error: "Paying for gifts isn't switched on here yet." };
    return await run(userId, wiring.deps);
  } catch (error) {
    logEvent("zinc.action_failed", { user_id: userId, ...errorFields(error) });
    return { error: "That didn't work. Try again in a minute." };
  }
}

export async function startZincConnect(): Promise<PaymentResult> {
  return withZinc((userId, deps) => startConnect(userId, deps, placeHeld));
}

export async function pollZincConnect(): Promise<PaymentResult> {
  return withZinc((userId, deps) => pollConnect(userId, deps, placeHeld));
}

export async function cancelZincConnect(): Promise<PaymentResult> {
  return withZinc((userId, deps) => cancelConnect(userId, deps));
}

// Disconnecting needs only sign-in (owner, S7): no paid features, and it works with Zinc
// switched off here (the key is still removed; clearing the webhook at Zinc is skipped).
export async function disconnectZincAccount(): Promise<PaymentResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { error: "Your session ended. Sign in again." };
  try {
    const db = createAdminClient();
    const wiring = await zincWiring(db);
    return await disconnectZinc(userId, { db, http: wiring?.deps.http ?? null });
  } catch (error) {
    logEvent("zinc.action_failed", { user_id: userId, ...errorFields(error) });
    return { error: "That didn't work. Try again in a minute." };
  }
}

export async function saveBuyerPhone(raw: string): Promise<PaymentResult> {
  return withZinc((userId, deps) => savePhone(userId, String(raw), deps, placeHeld));
}
