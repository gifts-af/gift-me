import { createClient } from "@/lib/supabase/server";
import { parseOverBudgetPct } from "./settings-rules";

export type ConciergeSettings = { overBudgetPct: number };
export type SaveResult = { ok: true } | { ok: false; error: string };

const OVER_BUDGET_ERROR = "Enter a whole number from 0 to 100.";

/**
 * The signed-in user's concierge settings. A first visit creates their
 * account row, so the database supplies the defaults from app_settings (T23)
 * rather than this code.
 */
export async function getConciergeSettings(): Promise<ConciergeSettings> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) throw new Error("Not signed in.");

  const accounts = supabase.schema("concierge").from("accounts");
  const { error: insertError } = await accounts.upsert(
    { user_id: userId },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`Couldn't set up your account: ${insertError.message}`);

  const { data, error } = await supabase
    .schema("concierge")
    .from("accounts")
    .select("over_budget_pct")
    .single();
  if (error) throw new Error(`Couldn't load your settings: ${error.message}`);
  return { overBudgetPct: data.over_budget_pct };
}

export async function saveConciergeSettings(input: { overBudgetPct: string }): Promise<SaveResult> {
  const overBudgetPct = parseOverBudgetPct(input.overBudgetPct);
  if (overBudgetPct === null) return { ok: false, error: OVER_BUDGET_ERROR };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  const { error } = await supabase
    .schema("concierge")
    .from("accounts")
    .update({ over_budget_pct: overBudgetPct })
    .eq("user_id", userId);
  if (error) {
    console.error("saving concierge settings failed", error);
    return { ok: false, error: "Your settings couldn't be saved. Try again." };
  }
  return { ok: true };
}
