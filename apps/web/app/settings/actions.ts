"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isTimeZone } from "@/lib/time-zones";
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
import { placeHeld, zincWiring } from "@/lib/wiring";

// Saves the time zone on its own, as the picker on Settings needs (ALL-115).
export async function saveTimezone(zone: string): Promise<SaveResult> {
  const value = String(zone);
  if (!isTimeZone(value)) return { ok: false, error: "Pick a time zone from the list." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  const { error } = await supabase.from("profiles").update({ timezone: value }).eq("id", userId);
  if (error) {
    logEvent("settings.timezone_save_failed", { user_id: userId, ...errorFields(error) });
    return { ok: false, error: "Your time zone couldn't be saved. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

// Saves the name a shared list shows (ALL-136). Only ever what the person
// typed: never filled in from Google or their email (T42). Empty clears it.
const MAX_DISPLAY_NAME = 80; // public.profiles.display_name's check
export async function saveDisplayName(name: string): Promise<SaveResult> {
  const value = String(name ?? "").trim();
  if (value.length > MAX_DISPLAY_NAME) return { ok: false, error: `Keep your name to ${MAX_DISPLAY_NAME} characters.` };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  const { error } = await supabase.from("profiles").update({ display_name: value || null }).eq("id", userId);
  if (error) {
    logEvent("settings.display_name_save_failed", { user_id: userId, ...errorFields(error) });
    return { ok: false, error: "Your name couldn't be saved. Try again." };
  }
  revalidatePath("/settings");
  revalidatePath("/settings/name");
  revalidatePath("/lists");
  return { ok: true };
}

// Saves the over-budget allowance on its own, as its page needs (ALL-115).
export async function saveOverBudget(value: string): Promise<SaveResult> {
  const result = await saveConciergeSettings({ overBudgetPct: String(value) });
  if (!result.ok) return result;
  revalidatePath("/settings");
  revalidatePath("/settings/over-budget");
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
      channels: defaultChannels(process.env),
      baseUrl,
      now: new Date(),
    });
    return result.ok ? { ok: true } : failed;
  } catch (error) {
    logEvent("settings.test_email_failed", { user_id: userId, ...errorFields(error) });
    return failed;
  }
}

// Paying for gifts (ALL-32). Each action checks who is signed in, builds the Zinc wiring and
// hands both to the module, which re-checks paid features before any Zinc call (AC-1). Results
// are plain data with no keys in them (AC-6); details go to the log as ids only (E6).
// The Settings list shows a one-word Zinc state, so it changes with the paying page. The paying
// page keeps its own state in the browser, so it isn't revalidated (that would re-run a Zinc call).
function refreshPaying() {
  revalidatePath("/settings");
}

// `refresh` says whether a result changes what Settings shows. Polling while waiting doesn't:
// a re-render then would push new props into the open connect screen every few seconds.
async function withZinc(
  run: (userId: string, deps: ZincDeps) => Promise<PaymentResult>,
  refresh: (result: PaymentResult) => boolean = () => true,
): Promise<PaymentResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { error: "Your session ended. Sign in again." };
  try {
    const wiring = await zincWiring(createAdminClient());
    if (!wiring) return { error: "Paying for gifts isn't switched on here yet." };
    const result = await run(userId, wiring.deps);
    if (refresh(result)) refreshPaying();
    return result;
  } catch (error) {
    logEvent("zinc.action_failed", { user_id: userId, ...errorFields(error) });
    return { error: "That didn't work. Try again in a minute." };
  }
}

export async function startZincConnect(): Promise<PaymentResult> {
  return withZinc((userId, deps) => startConnect(userId, deps, placeHeld));
}

export async function pollZincConnect(): Promise<PaymentResult> {
  return withZinc(
    (userId, deps) => pollConnect(userId, deps, placeHeld),
    (result) => "kind" in result && result.kind !== "waiting",
  );
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
    const result = await disconnectZinc(userId, { db, http: wiring?.deps.http ?? null });
    refreshPaying();
    return result;
  } catch (error) {
    logEvent("zinc.action_failed", { user_id: userId, ...errorFields(error) });
    return { error: "That didn't work. Try again in a minute." };
  }
}

export async function saveBuyerPhone(raw: string): Promise<PaymentResult> {
  return withZinc((userId, deps) => savePhone(userId, String(raw), deps, placeHeld));
}
