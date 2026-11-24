"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FACT_VALUE_MAX, type Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buyingWiring, lookupWiring, roundDbDeps, settingInt } from "@/lib/wiring";
import {
  approveAndBuy,
  costRecorder,
  markGiftArrived,
  MAX_BUDGET_CENTS,
  parseBudget,
  quoteFailedOrder,
  rejectionOutlook,
  rejectRoundIdeas,
  replaceFailedOrder,
  roundAccess,
  setRoundBudget,
  tellDelivered,
  type ShipTo,
} from "@/modules/concierge";
import type { BudgetResult, RejectResult } from "./[id]/round-screen";
import type { CheckResult } from "./[id]/fix/[orderId]/fix-screen";
import type { BuyResult } from "./outcome";

// The round, confirm and fix pages' server actions (ALL-29). Each takes the user from the session, validates
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

// ─── buying (the confirm and fix pages) ──────────────────────────────────────

const Text = z.string().max(200);
const ShipToForm = z.discriminatedUnion("shipTo", [
  z.object({ shipTo: z.literal("recipient") }),
  z.object({ shipTo: z.literal("buyer") }),
  z.object({
    shipTo: z.literal("other"),
    firstName: Text,
    lastName: Text,
    line1: Text,
    line2: Text,
    city: Text,
    state: Text,
    zip: Text,
    saveToPerson: z.literal("1").nullable(),
  }),
]);

/** Where it ships, from the form: undefined when the form doesn't say, null when it's malformed. */
function shipToOf(form: FormData): ShipTo | undefined | null {
  if (form.get("shipTo") === null) return undefined;
  const keys = ["shipTo", "firstName", "lastName", "line1", "line2", "city", "state", "zip", "saveToPerson"];
  const parsed = ShipToForm.safeParse(Object.fromEntries(keys.map((k) => [k, field(form, k)])));
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.shipTo !== "other") return { kind: d.shipTo };
  // The address itself is checked in the module (checkAddress); a bad one is no_address.
  const { firstName, lastName, line1, line2, city, state, zip } = d;
  return { kind: "other", address: { firstName, lastName, line1, line2, city, state, zip }, saveToPerson: d.saveToPerson === "1" };
}

/** Only the "Buy anyway" button sends over=1. The module checks the budget and allowance either way. */
const overOf = (form: FormData) => field(form, "over") === "1";

/** The confirm page's one button (AC-2, AC-4, AC-6, AC-8, AC-10, AC-11). */
export async function buyAction(roundId: string, form: FormData): Promise<BuyResult> {
  const id = RoundId.safeParse(roundId);
  // Input bounds, checked before anything else; not business limits. The page links at most the
  // round's ideas, and the module checks each idea is the round's and the note against
  // zinc_gift_message_max_chars (T23).
  const ideas = z.array(z.uuid()).min(1).max(50).safeParse((field(form, "ideas") ?? "").split(","));
  const note = z.string().max(2000).safeParse(field(form, "note") ?? "");
  const shipTo = shipToOf(form);
  if (!id.success || !ideas.success || !note.success || shipTo === null) return { ok: false, error: "bad_form" };
  const user = await signedIn();
  if (!user) return { ok: false, error: "session" };

  const { purchase } = await buyingWiring(new Date(), process.env, { user_id: user.userId });
  if (!purchase) return { ok: false, error: "zinc_off" };
  const result = await approveAndBuy(
    {
      userId: user.userId,
      roundId: id.data,
      ideaIds: [...new Set(ideas.data)],
      // Never logged (E6); the module checks it against zinc_gift_message_max_chars.
      ...(note.data.trim() ? { giftMessage: note.data } : {}),
      overBudgetConfirmed: overOf(form),
      ...(shipTo ? { shipTo } : {}),
    },
    purchase,
  );
  if (result.ok) revalidatePath(`/rounds/${id.data}`);
  return result;
}

/** The fix page's "Check today's price" (AC-14): one paid lookup, only on the tap. */
export async function checkPriceAction(roundId: string, orderId: string): Promise<CheckResult> {
  const id = RoundId.safeParse(roundId);
  const order = RoundId.safeParse(orderId);
  if (!id.success || !order.success) return { ok: false, error: "bad_form" };
  const user = await signedIn();
  if (!user) return { ok: false, error: "session" };
  // With buying off here the gift can't be re-bought, so a paid lookup would be wasted.
  const { purchase } = await buyingWiring(new Date(), process.env, { user_id: user.userId });
  if (!purchase) return { ok: false, error: "zinc_off" };
  const lookup = await lookupWiring(createAdminClient());
  if (!lookup) return { ok: false, error: "unavailable" };
  // quoteFailedOrder checks the round and order are this user's and the round can still change,
  // reads with the service role and looks up on the app's own key; it never orders.
  const result = await quoteFailedOrder(
    { userId: user.userId, roundId: id.data, orderId: order.data },
    { ...roundDbDeps(new Date()), lookup, recordCost: costRecorder(createAdminClient) },
  );
  return typeof result === "string" ? { ok: false, error: result } : { ok: true, oldCents: result.oldCents, newCents: result.newCents };
}

/** The fix page's buttons (AC-14, AC-15, AC-15a): the same gift again, or the next-best one. */
export async function replaceAction(roundId: string, orderId: string, form: FormData): Promise<BuyResult> {
  const id = RoundId.safeParse(roundId);
  const order = RoundId.safeParse(orderId);
  const idea = RoundId.safeParse(field(form, "ideaId"));
  const shownRaw = field(form, "shownTotalCents");
  const shown = shownRaw === null ? null : z.coerce.number().int().min(0).safeParse(shownRaw);
  const shipTo = shipToOf(form);
  if (!id.success || !order.success || !idea.success || (shown !== null && !shown.success) || shipTo === null) {
    return { ok: false, error: "bad_form" };
  }
  const user = await signedIn();
  if (!user) return { ok: false, error: "session" };

  const { purchase } = await buyingWiring(new Date(), process.env, { user_id: user.userId });
  if (!purchase) return { ok: false, error: "zinc_off" };
  const lookup = await lookupWiring(createAdminClient());
  // A price-rise re-buy looks the price up again under the lease; without the key it can't.
  if (!lookup && shown !== null) return { ok: false, error: "unavailable" };
  const result = await replaceFailedOrder(
    {
      userId: user.userId,
      roundId: id.data,
      failedOrderId: order.data,
      ideaId: idea.data,
      ...(shown?.success ? { shownTotalCents: shown.data } : {}),
      ...(shipTo ? { shipTo } : {}),
      overBudgetConfirmed: overOf(form),
    },
    { ...purchase, lookup, recordCost: costRecorder(createAdminClient) },
  );
  if (result.ok) revalidatePath(`/rounds/${id.data}`);
  return result;
}

// ─── tracking ────────────────────────────────────────────────────────────────

/**
 * "It arrived" on a shipped gift. The module refuses it while
 * order_tracking_enabled is off, and checks the order is the user's and this round's; the
 * delivered email goes once the round's last gift has arrived.
 */
export async function markArrived(roundId: string, orderId: string): Promise<{ ok: boolean }> {
  const id = RoundId.safeParse(roundId);
  const order = RoundId.safeParse(orderId);
  if (!id.success || !order.success) return { ok: false };
  const user = await signedIn();
  if (!user) return { ok: false };
  const db = createAdminClient();
  const result = await markGiftArrived(
    { userId: user.userId, roundId: id.data, orderId: order.data },
    {
      db,
      now: new Date(),
      setting: (key) => settingInt(db, key),
      tellDelivered: async (rid) => tellDelivered(rid, (await buyingWiring(new Date(), process.env, { user_id: user.userId })).engine),
    },
  );
  if (result.ok) revalidatePath(`/rounds/${id.data}`);
  return result;
}
