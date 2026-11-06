// Approving picks and buying them at once (ALL-30 AC-16, ALL-32 Task 6): what
// ALL-29's approval screen calls. It takes the round's lease, writes one held
// order per pick with its cap (AC-15) and address snapshot (D38) through
// approve_round, then tries to place them. A crash anywhere after approve_round
// leaves the round needs_attention/retry for the next tick (review focus 6).
import { classifyTotal, isShippableAddress } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { hasPaidFeatures } from "../paid-features";
import { EMAILED_REASONS, FAILURE_REASONS, placeRound, sequentialCaps } from "./place";
import {
  claimRoundNow,
  concierge,
  readAccount,
  readIdeas,
  readRound,
  recipientAddress,
  setting,
  type PurchaseDeps,
  withLease,
} from "./store";

export type ApproveInput = {
  userId: string;
  roundId: string;
  /** The picks; caps are given out in the ideas' rank order. */
  ideaIds: string[];
  giftMessage?: string;
  overBudgetConfirmed?: boolean;
};

export type ApproveError =
  | "not_found"
  | "busy"
  | "not_allowed"
  | "bad_ideas"
  | "needs_confirmation"
  | "over_budget"
  | "gift_message_too_long"
  | "no_address"
  | "claimed"
  | "not_open";

/**
 * `held`: waiting (on funds, setup, an address, our switch, or a retry); `failed`: it needs
 * the buyer (price_up, out_of_stock, too_late, failed). `reason` is the round's attention_reason.
 */
export type ApproveResult =
  | { ok: true; status: "ordered" | "held" | "failed"; reason: string | null }
  | { ok: false; error: ApproveError };

export async function approveAndBuy(input: ApproveInput, deps: PurchaseDeps): Promise<ApproveResult> {
  const { userId, roundId, ideaIds } = input;
  const ids = { round_id: roundId, user_id: userId };
  if (ideaIds.length === 0 || new Set(ideaIds).size !== ideaIds.length) return { ok: false, error: "bad_ideas" };
  const giftMessage = input.giftMessage?.trim() || null;
  if (giftMessage && giftMessage.length > (await setting(deps, "zinc_gift_message_max_chars"))) {
    return { ok: false, error: "gift_message_too_long" };
  }

  // Only the buyer's own round is ever leased.
  const round = await readRound(deps, roundId);
  if (!round || round.user_id !== userId) return { ok: false, error: "not_found" };

  // 1. The lease: a double tap or a second tab gets busy.
  const lock = await claimRoundNow(deps, roundId);
  if (!lock) return { ok: false, error: "busy" };

  const refused = await withLease(deps, roundId, lock, async (): Promise<ApproveResult | null> => {
    // 2. Paid features and the over-budget confirmation.
    if (!(await hasPaidFeatures(deps.db, userId))) return { ok: false, error: "not_allowed" };
    if (round.status !== "awaiting_approval") return { ok: false, error: "not_open" };
    const ideas = await readIdeas(deps, input.ideaIds);
    if (input.ideaIds.some((id) => !ideas.has(id))) return { ok: false, error: "bad_ideas" };
    // Rank order, which placeRound's cap re-check uses too.
    const picks = [...input.ideaIds].sort((a, b) => ideas.get(a)!.rank - ideas.get(b)!.rank);
    const totals = picks.map((id) => ideas.get(id)!.est_total_cents);
    const account = await readAccount(deps, userId);
    if (!account) return { ok: false, error: "not_allowed" };
    const sum = totals.reduce((a, b) => a + b, 0);
    const fit = classifyTotal(sum, round.budget_cents, account.over_budget_pct);
    if (fit === "dropped") return { ok: false, error: "over_budget" };
    if (fit === "over" && !input.overBudgetConfirmed) return { ok: false, error: "needs_confirmation" };

    // 3. The caps (AC-15). Within the budget the ceiling is the budget; confirmed over it, the picks' sum.
    let caps: number[];
    try {
      caps = sequentialCaps(
        totals.map((t) => ({ totalCents: t, feeCents: deps.settings.feeCents })),
        {
          ceilingCents: fit === "within" ? (round.budget_cents ?? sum) : sum,
          budgetCents: round.budget_cents,
          committedCents: 0,
          marginPct: deps.settings.marginPct,
        },
      );
    } catch (e) {
      if (e instanceof RangeError) return { ok: false, error: "over_budget" };
      throw e;
    }

    // Ships to the recipient (D38's other choices come with ALL-29's screen).
    const address = await recipientAddress(deps, round.person_id);
    if (!address || !isShippableAddress(address.draft)) return { ok: false, error: "no_address" };

    const { error } = await concierge(deps).rpc("approve_round", {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_orders: picks.map((id, i) => ({
        idea_id: id,
        max_price_cents: caps[i],
        fee_cents: deps.settings.feeCents,
        gift_message: giftMessage,
        ship_to: "recipient",
        address_source: address.source,
        address: address.snapshot,
      })),
    });
    if (error) {
      if (error.code === "P0001" && error.message.includes("approve_round: claimed")) return { ok: false, error: "claimed" };
      if (error.code === "P0001") {
        logEvent("order.approve_refused", ids);
        return { ok: false, error: "not_open" };
      }
      throw new Error(`Approving the round failed: ${error.message}`);
    }
    logEvent("order.approved", { ...ids, orders: picks.length });

    // 4. Place them now.
    await placeRound(roundId, lock, deps);
    return null;
  });
  if (refused) return refused;

  // 5. The customer is always told: an emailed hold's notice is unsent (next_action_at = now)
  //    and a failure needs them, so the engine takes the round straight away. A paused,
  //    not_allowed or retry hold waits for the tick, with no email.
  const after = await readRound(deps, roundId);
  const reason = after?.attention_reason ?? null;
  const failed = after?.status === "needs_attention" && reason !== null && FAILURE_REASONS.includes(reason);
  if (after?.status === "needs_attention" && reason !== null && (failed || EMAILED_REASONS.includes(reason))) {
    try {
      await deps.advanceRound(roundId);
    } catch (e) {
      // The tick tells them instead.
      logEvent("order.hold_notice_deferred", { ...ids, ...errorFields(e) });
    }
  }
  const status = after?.status === "ordered" ? "ordered" : failed ? "failed" : "held";
  return { ok: true, status, reason: status === "ordered" ? null : reason };
}
