"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FACT_VALUE_MAX, type Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { roundDbDeps } from "@/app/settings/zinc-deps";
import {
  MAX_BUDGET_CENTS,
  parseBudget,
  rejectionOutlook,
  rejectRoundIdeas,
  roundAccess,
  setRoundBudget,
} from "@/modules/concierge";
import type { BudgetResult, RejectResult } from "./[id]/round-screen";

// The round screen's server actions (ALL-29). Each takes the user from the session, validates
// its input, and leaves ownership to the module, which checks the round is theirs again on the
// server (Next's server-actions.md > Security). They return only what the screen shows.

const Code = z.enum(["has_it", "not_style", "too_pricey", "too_generic"]);
const RoundId = z.uuid();

async function signedIn(): Promise<{ userId: string; userDb: SupabaseClient<Database> } | null> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  return userId ? { userId, userDb: supabase as unknown as SupabaseClient<Database> } : null;
}

const RejectForm = z.object({
  code: Code,
  owned: z.uuid().nullable(),
  // The profile_facts limit, after trimming; the module checks it again (too_long).
  text: z.string().trim().max(FACT_VALUE_MAX),
  expectMore: z.enum(["0", "1"]),
});

const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
};

/** "None of these" (AC-12, AC-13a). */
export async function rejectAction(roundId: string, form: FormData): Promise<RejectResult> {
  const id = RoundId.safeParse(roundId);
  const parsed = RejectForm.safeParse({
    code: field(form, "code"),
    owned: field(form, "owned") || null,
    text: field(form, "text") ?? "",
    expectMore: field(form, "expectMore"),
  });
  if (!id.success || !parsed.success) return { ok: false, error: "bad_form" };
  const user = await signedIn();
  if (!user) return { ok: false, error: "session" };

  const { code, owned, text, expectMore } = parsed.data;
  const result = await rejectRoundIdeas(
    { userId: user.userId, roundId: id.data, code, text: text || null, ownedIdeaId: owned, expectMore: expectMore === "1" },
    roundDbDeps(new Date()),
  );
  if (result.ok) revalidatePath(`/rounds/${id.data}`);
  return result;
}

/**
 * Whether this reason still brings new ideas, for the sheet (AC-13a). Only reads; the round
 * must be the signed-in user's. Null when it can't say.
 */
export async function outlookAction(
  roundId: string,
  input: { code: string; ownedIdeaId: string | null; text: string | null },
): Promise<boolean | null> {
  const id = RoundId.safeParse(roundId);
  const parsed = z
    .object({ code: Code, ownedIdeaId: z.uuid().nullable(), text: z.string().trim().max(FACT_VALUE_MAX).nullable() })
    .safeParse(input);
  if (!id.success || !parsed.success) return null;
  const user = await signedIn();
  if (!user) return null;
  const deps = roundDbDeps(new Date());
  if ((await roundAccess(id.data, user.userId, deps)) !== "mine") return null;
  const { code, ownedIdeaId, text } = parsed.data;
  return rejectionOutlook({ roundId: id.data, code, text: text || null, ownedIdeaId }, deps);
}

const BUDGET_MESSAGES = {
  busy: "This round is busy right now. Try again in a minute.",
  already_set: "This round already has a budget. Reload to see it.",
  not_open: "This round can't be changed now. Reload to see what happened.",
} as const;

/** "Your budget" on a round that has none (AC-9). */
export async function setBudgetAction(roundId: string, form: FormData): Promise<BudgetResult> {
  const id = RoundId.safeParse(roundId);
  if (!id.success) return { ok: false, error: "That didn't go through. Reload and try again." };
  const raw = z.string().max(20).safeParse(field(form, "budget") ?? "");
  if (!raw.success) return { ok: false, error: "Enter an amount like 75 or 75.50." };
  const parsed = parseBudget(raw.data);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  // Left empty, nothing is saved (AC-9).
  if (parsed.cents === null) return { ok: false, error: "Enter an amount like 75 or 75.50." };
  if (parsed.cents > MAX_BUDGET_CENTS) return { ok: false, error: "That amount is too large." };
  const user = await signedIn();
  if (!user) return { ok: false, error: "Your session ended. Sign in again." };

  const result = await setRoundBudget({ userId: user.userId, roundId: id.data, budgetCents: parsed.cents }, user.userDb, roundDbDeps(new Date()));
  if (result === "saved" || result === "already_set") revalidatePath(`/rounds/${id.data}`);
  return result === "saved" ? { ok: true } : { ok: false, error: BUDGET_MESSAGES[result] };
}
