// Placing approved gifts from the user's own Zinc wallet (ALL-32 Task 6, ALL-30
// AC-17 to AC-21). Never over the cap, never twice, never after the round closed:
//
// - placeRound runs with the round's lease held, and never writes round status.
//   Every write goes through the money-path SQL, which locks the round row and
//   lets reconcile_round decide the status (plan, "How reconcile_round decides").
// - begin_placing is the last word under the lock: it re-checks everything and
//   flips held → placing (committed) before any POST.
// - An order whose POST outcome isn't known stays placing; the sweep looks it
//   up at Zinc and never resends (owner, 2026-11-06).
//
// Everything arrives through `deps` (E3). Events carry ids and cents only (E6).
import {
  approvalCeilingCents,
  canArriveInTime,
  committedSpendCents,
  isShippableAddress,
  maxPriceCents,
  PLACEABLE_HOLDS,
  shortfallCents,
  type AttentionReason,
  type CommittedOrder,
} from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import { hasPaidFeatures } from "../paid-features";
import { getWallet } from "../zinc/account";
import { ZincError } from "../zinc/client";
import { failureType } from "../zinc/events";
import { findOrderByReference } from "../zinc/orders";
import { placeWithRetry } from "../zinc/retry";
import type { ZincAddress } from "../zinc/types";
import {
  claimRoundNow,
  concierge,
  fail,
  liveOrders,
  readAccount,
  readIdeas,
  readKey,
  readRound,
  recipientAddress,
  releaseRound,
  roundRpc,
  roundStillWanted,
  savedSnapshots,
  scheduleSettings,
  setting,
  type AddressSnapshot,
  type OrderRow,
  type PurchaseDeps,
  type RoundRow,
} from "./store";

export type PlaceOutcome = "ordered" | "held" | "not_ready";

/** Hold reasons the customer is emailed about at once (reconcile_round rule 5). */
export const EMAILED_REASONS: readonly string[] = ["funds", "setup", "address", "unconfirmed"];

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function outcomeOf(status: string | null): PlaceOutcome {
  if (status === "ordered") return "ordered";
  if (status === "needs_attention") return "held";
  return "not_ready";
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Each pick's max_price, in order: earlier picks' caps and fees count as committed,
 * later picks' approved totals are held back (AC-15), so together they never pass the
 * ceiling. Throws RangeError when there's no room (maxPriceCents).
 */
export function sequentialCaps(
  picks: { totalCents: number; feeCents: number }[],
  p: { ceilingCents: number; budgetCents: number | null; committedCents: number; marginPct: number },
): number[] {
  let committed = p.committedCents;
  return picks.map((pick, i) => {
    const reserved = picks.slice(i + 1).reduce((sum, x) => sum + x.totalCents, 0);
    const cap = maxPriceCents({
      ceilingCents: p.ceilingCents,
      budgetCents: p.budgetCents,
      committedCents: committed,
      reservedCents: reserved,
      feeCents: pick.feeCents,
      pickTotalCents: pick.totalCents,
      marginPct: p.marginPct,
    });
    committed += cap + pick.feeCents;
    return cap;
  });
}

function asCommitted(o: OrderRow): CommittedOrder {
  const status = (o.status === "unconfirmed" ? "placing" : o.status) as CommittedOrder["status"];
  return { id: o.id, status, maxPriceCents: o.max_price_cents, finalTotalCents: o.total_cents, feeCents: o.fee_cents };
}

/** min(saved, recomputed) for each held order (AC-21); the saved cap when the recompute can't be made. */
function recheckedCaps(
  r: RoundRow,
  held: OrderRow[],
  all: OrderRow[],
  totals: Map<string, number>,
  overBudgetPct: number,
  marginPct: number,
): number[] {
  const saved = held.map((o) => o.max_price_cents);
  try {
    const heldIds = held.map((o) => o.id);
    // The approval was checked (and any over-budget confirmed) when it was made.
    const ceiling = approvalCeilingCents(
      all.map((o) => totals.get(o.idea_id) ?? 0),
      r.budget_cents,
      overBudgetPct,
      true,
    );
    if (ceiling === null) throw new RangeError("No ceiling");
    const fresh = sequentialCaps(
      held.map((o) => ({ totalCents: totals.get(o.idea_id) ?? 0, feeCents: o.fee_cents })),
      {
        ceilingCents: ceiling,
        budgetCents: r.budget_cents,
        committedCents: committedSpendCents(all.map(asCommitted), heldIds),
        marginPct,
      },
    );
    return saved.map((s, i) => Math.min(s, fresh[i]));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    // Never above what the buyer approved: the saved cap stands.
    logEvent("order.cap_recheck_failed", { round_id: r.id, user_id: r.user_id });
    return saved;
  }
}

function toZincAddress(a: AddressSnapshot): ZincAddress {
  return {
    firstName: a.recipient_first_name,
    lastName: a.recipient_last_name,
    line1: a.address_line1,
    line2: a.address_line2,
    city: a.city,
    state: a.state,
    postalCode: a.zip,
    country: a.country,
  };
}

type Result = {
  order_id: string;
  outcome: "sent" | "insufficient" | "unsent" | "rejected" | "unknown";
  provider_order_id?: string;
  available_cents?: number;
  failure_type?: string;
};

/**
 * Places a round's held orders. The caller holds the lease (`lock`) and releases it.
 * "not_ready" when the round isn't one to place now (nothing is written then).
 */
export async function placeRound(roundId: string, lock: Date | string, deps: PurchaseDeps): Promise<PlaceOutcome> {
  const lockIso = typeof lock === "string" ? lock : lock.toISOString();
  const today = dayOf(deps.now);
  const r = await readRound(deps, roundId);
  if (
    !r ||
    !r.locked_until ||
    new Date(r.locked_until).getTime() !== new Date(lockIso).getTime() ||
    r.status !== "needs_attention" ||
    !PLACEABLE_HOLDS.includes(r.attention_reason as AttentionReason) ||
    r.closed_at !== null ||
    !(today < r.ship_by_deadline) ||
    !(await roundStillWanted(deps, r))
  ) {
    return "not_ready";
  }
  const ids = { round_id: r.id, user_id: r.user_id };
  const all = await liveOrders(deps, roundId);
  if (!all.some((o) => o.status === "held")) return "not_ready";
  // In the ideas' rank order, the same order approval gave out the caps in.
  const roundIdeas = await readIdeas(deps, all.map((o) => o.idea_id));
  const rank = (ideaId: string) => roundIdeas.get(ideaId)?.rank ?? Number.MAX_SAFE_INTEGER;
  all.sort((a, b) => rank(a.idea_id) - rank(b.idea_id));
  const held = all.filter((o) => o.status === "held");

  // 1. Gates, before any Zinc call: the kill switch, paid features, setup.
  const gate = async (reason: "paused" | "not_allowed" | "setup") =>
    outcomeOf(await roundRpc(deps, "gate_held_orders", { p_round_id: roundId, p_reason: reason }));
  if ((await setting(deps, "zinc_ordering_enabled")) !== 1) {
    logEvent("order.paused", ids);
    return gate("paused");
  }
  if (!(await hasPaidFeatures(deps.db, r.user_id))) return gate("not_allowed");
  const account = await readAccount(deps, r.user_id);
  const key = await readKey(deps, r.user_id);
  if (!account?.zinc_connected_at || !account.buyer_phone || !key) return gate("setup");
  if (key.env !== deps.env) {
    // Never a live order with a test key, or the other way round.
    logEvent("zinc.env_mismatch", ids);
    return gate("setup");
  }

  // 2. Still on time, and still something to buy.
  const ideas = roundIdeas;
  const schedule = await scheduleSettings(deps);
  let failed: string | null = null;
  for (const o of held) {
    const idea = ideas.get(o.idea_id);
    let failure: string | null = null;
    if (!idea?.product_url) failure = "failed";
    else if (
      idea.handling_days_max !== null &&
      idea.delivery_days_max !== null &&
      !canArriveInTime(
        { occasionDate: r.occasion_date, orderDate: today, handlingDaysMax: idea.handling_days_max, deliveryDaysMax: idea.delivery_days_max },
        schedule,
      )
    ) {
      failure = "too_late";
    }
    if (failure) {
      failed = await roundRpc(deps, "fail_order", { p_order_id: o.id, p_failure_type: failure });
      logEvent("order.not_placed", { ...ids, order_id: o.id, failure_type: failure });
    }
  }
  // A failure needs the buyer first (reconcile's order), and begin_placing would refuse.
  if (failed !== null) return outcomeOf(failed);

  // 3. Where it ships: the recipient's address read now; anything else, the saved snapshot (D38).
  const addresses = new Map<string, AddressSnapshot>();
  const fresh = new Set<string>();
  const saved = await savedSnapshots(deps, held.map((o) => o.id));
  const recipient = held.some((o) => o.ship_to === "recipient") ? await recipientAddress(deps, r.person_id) : null;
  for (const o of held) {
    if (o.ship_to === "recipient" && recipient && isShippableAddress(recipient.draft)) {
      addresses.set(o.id, recipient.snapshot);
      fresh.add(o.id);
    } else if (o.ship_to !== "recipient" && saved.has(o.id)) {
      addresses.set(o.id, saved.get(o.id)!);
    } else {
      logEvent("order.address_missing", { ...ids, order_id: o.id });
      return outcomeOf(await roundRpc(deps, "hold_orders", { p_round_id: roundId, p_reason: "address" }));
    }
  }

  // 4. Caps, re-checked: never above the saved one.
  const totals = new Map([...roundIdeas].map(([id, i]) => [id, i.est_total_cents]));
  const caps = recheckedCaps(r, held, all, totals, account.over_budget_pct, deps.settings.marginPct);

  // 5. Known short: only when auto top-up is known to be off; otherwise Zinc may charge the card.
  if (account.auto_topup_on === false) {
    let balance: number;
    try {
      balance = (await getWallet(deps.http, key.apiKey)).balanceCents;
    } catch (e) {
      // Can't tell; nothing is sent. The hold stays and the next tick tries again.
      logEvent("zinc.wallet_unavailable", { ...ids, kind: e instanceof ZincError ? e.kind : "unknown" });
      return "held";
    }
    const { error } = await concierge(deps).rpc("set_seen_balance", { p_round_id: roundId, p_cents: balance });
    if (error) fail("Saving the balance failed", error);
    const short = shortfallCents(held.map((o, i) => ({ maxPriceCents: caps[i], feeCents: o.fee_cents })), balance);
    if (short > 0) {
      logEvent("order.short", { ...ids, shortfall_cents: short });
      return outcomeOf(await roundRpc(deps, "hold_orders", { p_round_id: roundId, p_reason: "funds" }));
    }
  }

  // Read before begin_placing, so nothing can fail between it and the POSTs but the POSTs.
  const [budgetMs, attempts, baseMs] = await Promise.all([
    setting(deps, "zinc_place_budget_ms"),
    setting(deps, "zinc_retry_attempts"),
    setting(deps, "zinc_retry_base_ms"),
  ]);

  // 6. Begin: the final checks under the lock, held → placing, committed before any POST.
  const begin = await concierge(deps).rpc("begin_placing", {
    p_round_id: roundId,
    p_lock: lockIso,
    p_today: today,
    p_orders: held.map((o, i) => ({
      id: o.id,
      max_price_cents: caps[i],
      ...(fresh.has(o.id) ? { address: addresses.get(o.id) } : {}),
    })),
  });
  if (begin.error) fail("Beginning to place failed", begin.error);
  const placing = ((begin.data ?? []) as { id: string; idea_id: string; idempotency_key: string; max_price_cents: number; gift_message: string | null }[])
    .sort((a, b) => rank(a.idea_id) - rank(b.idea_id));
  if (placing.length === 0) {
    logEvent("order.begin_refused", ids);
    return outcomeOf((await readRound(deps, roundId))?.status ?? null);
  }

  // 7. POST each one, within the time budget.
  const retry = { attempts, baseMs, sleep: deps.sleep ?? realSleep, random: Math.random };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const results: Result[] = [];
  let rest: "unsent" | "insufficient" | null = null;
  let unauthorized = false;

  for (const o of placing) {
    if (rest === null && clock() - started >= budgetMs) {
      logEvent("order.place_budget_spent", ids);
      rest = "unsent";
    }
    if (rest !== null) {
      results.push({ order_id: o.id, outcome: rest });
      continue;
    }
    const input = {
      reference: o.id,
      idempotencyKey: o.idempotency_key,
      productUrl: ideas.get(o.idea_id)!.product_url!,
      maxPriceCents: o.max_price_cents,
      shipTo: toZincAddress(addresses.get(o.id)!),
      phone: account.buyer_phone,
      giftMessage: o.gift_message,
    };
    try {
      const res = await placeWithRetry(deps.http, key.apiKey, input, retry);
      if ("insufficient" in res) {
        results.push({ order_id: o.id, outcome: "insufficient", available_cents: res.insufficient.availableCents });
        rest = "insufficient";
      } else if (res.existing?.status === "failed") {
        results.push({ order_id: o.id, outcome: "rejected", failure_type: failureType(res.existing.errorType) });
      } else {
        results.push({ order_id: o.id, outcome: "sent", provider_order_id: res.providerOrderId });
      }
    } catch (e) {
      if (e instanceof ZincError && e.kind === "rejected") {
        // A synchronous 4xx: nothing was created at Zinc.
        results.push({ order_id: o.id, outcome: "rejected", failure_type: failureType(e.code) });
      } else if (e instanceof ZincError && e.kind === "unauthorized") {
        // The key was revoked: nothing was created, and setup needs the buyer.
        results.push({ order_id: o.id, outcome: "unsent" });
        rest = "unsent";
        unauthorized = true;
      } else {
        // It may exist at Zinc: it stays placing for the sweep, and nothing more is sent now.
        results.push({ order_id: o.id, outcome: "unknown" });
        rest = "unsent";
        logEvent("order.outcome_unknown", { ...ids, order_id: o.id, kind: e instanceof ZincError ? e.kind : "unknown" });
      }
    }
  }

  // 8. Record what happened; only orders still placing are touched, so a faster webhook wins.
  let status = await roundRpc(deps, "record_outcomes", { p_round_id: roundId, p_results: results });
  for (const res of results) {
    logEvent("order.place_result", {
      ...ids,
      order_id: res.order_id,
      outcome: res.outcome,
      ...(res.available_cents !== undefined ? { available_cents: res.available_cents } : {}),
    });
  }
  if (unauthorized) {
    logEvent("zinc.unauthorized", ids);
    status = await roundRpc(deps, "gate_held_orders", { p_round_id: roundId, p_reason: "setup" });
  }
  return outcomeOf(status);
}

/**
 * Tries the user's held rounds again (AC-21): claim, place, release, earliest deadline
 * first. Matches PlaceHeld once `deps` is bound. No held rounds means no Zinc call.
 */
export async function placeHeldForUser(userId: string, deps: PurchaseDeps): Promise<void> {
  const { data, error } = await concierge(deps).rpc("held_rounds_for_user", { p_user_id: userId });
  if (error) fail("Loading held rounds failed", error);
  for (const round of data ?? []) {
    const lock = await claimRoundNow(deps, round.id);
    if (!lock) continue;
    try {
      const outcome = await placeRound(round.id, lock, deps);
      logEvent("order.place_held", { round_id: round.id, user_id: userId, outcome });
    } finally {
      await releaseRound(deps, round.id, lock);
    }
  }
}

/**
 * Orders left placing longer than placing_stale_minutes (a crash, a timeout): looked up at
 * Zinc by our reference and settled; one Zinc can't find is marked unconfirmed for the
 * owner. It never resends (owner, 2026-11-06). Returns how many it settled or marked.
 */
export async function sweepStalePlacing(deps: PurchaseDeps): Promise<number> {
  const db = concierge(deps);
  const { data, error } = await db.rpc("stale_placing_orders", { p_now: deps.now.toISOString() });
  if (error) fail("Loading stale orders failed", error);
  let done = 0;
  for (const o of data ?? []) {
    const ids = { order_id: o.id, round_id: o.round_id, user_id: o.user_id };
    try {
      const key = await readKey(deps, o.user_id);
      if (!key || key.env !== deps.env) {
        // Looking it up with no key, or the other environment's, would wrongly find nothing.
        logEvent("order.sweep_skipped", { ...ids, reason: key ? "env_mismatch" : "no_key" });
        continue;
      }
      const found = await findOrderByReference(deps.http, key.apiKey, o.id);
      if (!found) {
        await roundRpc(deps, "mark_unconfirmed", { p_order_id: o.id });
        logEvent("order.unconfirmed", ids);
        done++;
        continue;
      }
      if (found.status === "pending") continue; // still processing at Zinc: its webhook or a later sweep settles it
      const settled = await db.rpc("settle_order", {
        p_user_id: o.user_id,
        p_order_id: o.id,
        p_status: found.status,
        p_failure_type: found.status === "failed" ? failureType(found.errorType) : "failed",
        p_price: { provider_order_id: found.providerOrderId },
      });
      if (settled.error) fail("Settling the order failed", settled.error);
      logEvent("order.swept", { ...ids, status: found.status });
      done++;
    } catch (e) {
      // One order can't stop the rest; the next sweep tries again.
      logEvent("order.sweep_failed", { ...ids, name: e instanceof Error ? e.name : "unknown" });
    }
  }
  return done;
}

