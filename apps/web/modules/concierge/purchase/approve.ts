// Approving picks and buying them at once (ALL-30 AC-16, ALL-32 Task 6, ALL-29): what
// the approval screen calls. It takes the round's lease, reads the round again under it
// (AC-9), writes one held order per pick with its cap (AC-15) and address snapshot (D38)
// through approve_round, then tries to place them. A crash anywhere after approve_round
// leaves the round needs_attention/retry for the next tick (review focus 6).
import { checkAddress, classifyTotal, isShippableAddress, type Address, type AddressDraft } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { hasPaidFeatures } from "../paid-features";
import { EMAILED_REASONS, FAILURE_REASONS, placeRound, sequentialCaps } from "./place";
import {
  buyerAddress,
  claimRoundNow,
  concierge,
  readAccount,
  readIdeas,
  hasUntoldFailure,
  readRound,
  recipientAddress,
  savePersonAddress,
  setting,
  type Account,
  type AddressSnapshot,
  type AddressSource,
  type PurchaseDeps,
  type RoundRow,
  withLease,
} from "./store";

/**
 * Where the gifts ship (AC-10, D38): the recipient (their shared address or the one saved on
 * the person, read again when placing), the buyer's own address, or another address, which
 * can be saved to the person too.
 */
export type ShipTo = { kind: "recipient" } | { kind: "buyer" } | { kind: "other"; address: AddressDraft; saveToPerson: boolean };

export type ApproveInput = {
  userId: string;
  roundId: string;
  /** The picks; caps are given out in the ideas' rank order. */
  ideaIds: string[];
  giftMessage?: string;
  overBudgetConfirmed?: boolean;
  /** The recipient when left out. */
  shipTo?: ShipTo;
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
  | "not_open"
  /** A picked idea isn't on offer any more: "None of these" or another purchase replaced it (AC-12b). */
  | "replaced"
  /** A list gift whose list the buyer can no longer see (AC-30a). */
  | "not_shared"
  /** A list gift already on another of the buyer's live orders (AC-30). */
  | "already_bought";

/**
 * `held`: waiting (on funds, setup, an address, our switch, or a retry); `failed`: it needs
 * the buyer (price_up, out_of_stock, too_late, failed). `reason` is the round's attention_reason.
 */
export type ApproveResult =
  | { ok: true; status: "ordered" | "held" | "failed"; reason: string | null }
  | { ok: false; error: ApproveError };

/**
 * Each pick's price cap, and the most the wallet can be charged for them all (caps plus
 * fees, "never more than"). `committedCents` is what the round's other live orders already
 * hold (committedSpendCents); the budget check counts it with the picks. Shared by
 * approveAndBuy, replaceFailedOrder and the confirm page.
 */
export function capsFor(
  round: RoundRow,
  totals: number[],
  account: Account,
  confirmed: boolean,
  settings: { feeCents: number; marginPct: number },
  committedCents: number,
): { caps: number[]; neverMoreThanCents: number } | ApproveError {
  const spend = committedCents + totals.reduce((a, b) => a + b, 0);
  const fit = classifyTotal(spend, round.budget_cents, account.over_budget_pct);
  if (fit === "dropped") return "over_budget";
  if (fit === "over" && !confirmed) return "needs_confirmation";
  // Within the budget the ceiling is the budget; confirmed over it (or no budget), the spend itself.
  const ceilingCents = fit === "within" ? (round.budget_cents ?? spend) : spend;
  try {
    const caps = sequentialCaps(
      totals.map((t) => ({ totalCents: t, feeCents: settings.feeCents })),
      { ceilingCents, budgetCents: round.budget_cents, committedCents, marginPct: settings.marginPct },
    );
    return { caps, neverMoreThanCents: caps.reduce((sum, cap) => sum + cap + settings.feeCents, 0) };
  } catch (e) {
    if (e instanceof RangeError) return "over_budget";
    throw e;
  }
}

/** An order's destination, as approve_round and replace_failed_order take it. */
export type Destination = {
  ship_to: "recipient" | "buyer" | "other";
  address_source: AddressSource;
  address: AddressSnapshot;
  /** Saved to the person once the order is written (AC-10). */
  saveToPerson?: Address;
};

/** Where a ShipTo goes, read now; null when there's no usable address. */
export async function destinationFor(deps: PurchaseDeps, userId: string, personId: string, shipTo: ShipTo): Promise<Destination | null> {
  if (shipTo.kind === "recipient") {
    const a = await recipientAddress(deps, personId);
    return a && isShippableAddress(a.draft) ? { ship_to: "recipient", address_source: a.source, address: a.snapshot } : null;
  }
  if (shipTo.kind === "buyer") {
    const a = await buyerAddress(deps, userId);
    return a && isShippableAddress(a.draft) ? { ship_to: "buyer", address_source: "own", address: a.snapshot } : null;
  }
  const checked = checkAddress(shipTo.address);
  if (!checked.ok) return null;
  const a = checked.value;
  return {
    ship_to: "other",
    address_source: "own",
    address: {
      recipient_first_name: a.firstName,
      recipient_last_name: a.lastName,
      address_line1: a.line1,
      address_line2: a.line2,
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: "US",
      phone: null,
    },
    ...(shipTo.saveToPerson ? { saveToPerson: a } : {}),
  };
}

/** Saves "another address" to the person after the order is written; a failure never undoes the order. */
export async function saveDestination(deps: PurchaseDeps, userId: string, personId: string, d: Destination, ids: Record<string, string>): Promise<void> {
  if (!d.saveToPerson) return;
  try {
    await savePersonAddress(deps, userId, personId, d.saveToPerson);
  } catch (e) {
    logEvent("order.address_save_failed", { ...ids, ...errorFields(e) });
  }
}

/** approve_round's and replace_failed_order's refusals: the word after "<fn>: ". */
export function refusalOf(message: string, fn: string): string {
  return message.startsWith(`${fn}: `) ? message.slice(fn.length + 2) : "";
}

export async function approveAndBuy(input: ApproveInput, deps: PurchaseDeps): Promise<ApproveResult> {
  const { userId, roundId, ideaIds } = input;
  const ids = { round_id: roundId, user_id: userId };
  if (ideaIds.length === 0 || new Set(ideaIds).size !== ideaIds.length) return { ok: false, error: "bad_ideas" };
  const giftMessage = input.giftMessage?.trim() || null;
  if (giftMessage && giftMessage.length > (await setting(deps, "zinc_gift_message_max_chars"))) {
    return { ok: false, error: "gift_message_too_long" };
  }

  // Only the buyer's own round is ever leased.
  const owned = await readRound(deps, roundId);
  if (!owned || owned.user_id !== userId) return { ok: false, error: "not_found" };

  // 1. The lease: a double tap or a second tab gets busy. A round that's generating again
  //    after "None of these" can't be leased; its rejected ideas say they were replaced.
  const lock = await claimRoundNow(deps, roundId);
  if (!lock) {
    const ideas = await readIdeas(deps, ideaIds);
    const stale = [...ideas.values()].some((i) => i.round_id === roundId && i.status === "rejected");
    return { ok: false, error: stale ? "replaced" : "busy" };
  }

  const refused = await withLease(deps, roundId, lock, async (): Promise<ApproveResult | null> => {
    // 2. Paid features, then the round as it is now, under the lease (AC-9).
    if (!(await hasPaidFeatures(deps.db, userId))) return { ok: false, error: "not_allowed" };
    const round = await readRound(deps, roundId);
    if (!round || round.user_id !== userId) return { ok: false, error: "not_found" };
    const ideas = await readIdeas(deps, input.ideaIds);
    if (input.ideaIds.some((id) => ideas.get(id)?.round_id !== roundId)) return { ok: false, error: "bad_ideas" };
    if (input.ideaIds.some((id) => ideas.get(id)!.status !== "proposed")) return { ok: false, error: "replaced" };
    if (round.status !== "awaiting_approval") return { ok: false, error: "not_open" };
    // Rank order, which placeRound's cap re-check uses too.
    const picks = [...input.ideaIds].sort((a, b) => ideas.get(a)!.rank - ideas.get(b)!.rank);
    const account = await readAccount(deps, userId);
    if (!account) return { ok: false, error: "not_allowed" };

    // 3. The budget check and the caps (AC-6, AC-7, AC-15).
    const fit = capsFor(round, picks.map((id) => ideas.get(id)!.est_total_cents), account, input.overBudgetConfirmed === true, deps.settings, 0);
    if (typeof fit === "string") return { ok: false, error: fit };

    // 4. Where it ships (AC-10).
    const dest = await destinationFor(deps, userId, round.person_id, input.shipTo ?? { kind: "recipient" });
    if (!dest) return { ok: false, error: "no_address" };

    const { error } = await concierge(deps).rpc("approve_round", {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_orders: picks.map((id, i) => ({
        idea_id: id,
        max_price_cents: fit.caps[i],
        fee_cents: deps.settings.feeCents,
        gift_message: giftMessage,
        ship_to: dest.ship_to,
        address_source: dest.address_source,
        address: dest.address,
      })),
    });
    if (error) {
      if (error.code !== "P0001") throw new Error(`Approving the round failed: ${error.message}`);
      const refusal = refusalOf(error.message, "approve_round");
      if (refusal === "claimed" || refusal === "replaced" || refusal === "not_shared" || refusal === "already_bought") {
        logEvent("order.approve_refused", { ...ids, reason: refusal });
        return { ok: false, error: refusal };
      }
      logEvent("order.approve_refused", ids);
      return { ok: false, error: "not_open" };
    }
    logEvent("order.approved", { ...ids, orders: picks.length });
    await saveDestination(deps, userId, round.person_id, dest, ids);

    // 5. Place them now.
    await placeRound(roundId, lock, deps);
    return null;
  });
  if (refused) return refused;
  return tellCustomer(deps, roundId, ids);
}

/**
 * The customer is always told: an emailed hold's notice is unsent (next_action_at = now)
 * and a failure needs them, so the engine takes the round straight away. A paused,
 * not_allowed or retry hold waits for the tick, with no email.
 * A failure no longer always shows in the reason (a hold outranks it, ALL-116), so the
 * round's untold failures are read too.
 */
export async function tellCustomer(deps: PurchaseDeps, roundId: string, ids: Record<string, string>): Promise<ApproveResult> {
  const after = await readRound(deps, roundId);
  const reason = after?.attention_reason ?? null;
  const untold = after?.status === "needs_attention" && (await hasUntoldFailure(deps, roundId));
  const failed = after?.status === "needs_attention" && (untold || (reason !== null && FAILURE_REASONS.includes(reason)));
  if (after?.status === "needs_attention" && (failed || (reason !== null && EMAILED_REASONS.includes(reason)))) {
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
