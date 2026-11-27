// Replacing a failed gift (ALL-29 AC-14, AC-15, AC-15a): the fix page's "Check today's
// price" (quoteFailedOrder, read-only, only on a tap) and its "Buy" (replaceFailedOrder).
// The replacement goes through replace_failed_order under the round lease, with the cap
// worked out like approveAndBuy's, then it's placed and the buyer told the same way.
//
// A re-quote looks the idea up on the app's own lookup key (T17), an AI idea by its saved
// retailer and product id and a list gift by its link, as the idea run priced it: Amazon and
// Walmart through their offers, preferring the idea's own offer; other stores through the
// product's details. A gift priced from its list (no product id) can't be re-quoted. Events
// carry ids, cents and reason codes only (E6); a Zinc failure logs only its kind, never its
// message (a Shopify path holds the handle).
import { committedSpendCents, estimatedTotalCents, isShippableAddress, pickOffer, type ZincOffer } from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import type { Cost, RecordCost } from "../costs/record";
import { hasPaidFeatures } from "../paid-features";
import { ZincError, type ZincHttp } from "../zinc/client";
import { listGiftRoute, productDetails, productOffers, type AmazonShipping, type ListGiftRoute, type ZincStep } from "../zinc/products";
import type { DbDeps } from "../zinc/types";
import {
  CARD_REFUSALS,
  destinationFor,
  moneyFields,
  refusalOf,
  saveDestination,
  shownTooLow,
  tellCustomer,
  type ApproveError,
  type ApproveResult,
  type Destination,
  type ShipTo,
} from "./approve";
import { capsForPayer, ideaTotalCents, readPayer, type Payer } from "./payer";
import { asCommitted, placeRound } from "./place";
import {
  claimRoundNow,
  concierge,
  liveOrders,
  priceRiseFixed,
  readAccount,
  readIdeas,
  readOrder,
  readRound,
  recipientAddress,
  savedSnapshots,
  setting,
  type AddressSnapshot,
  type AddressSource,
  type FailedOrderRow,
  type IdeaRow,
  type PurchaseDeps,
  withLease,
} from "./store";

/**
 * Our database and clock plus the app's own lookup key, as the idea run uses it (ZINC_API_KEY, T17),
 * and where a lookup's cost is recorded (never throws).
 */
export type QuoteDeps = DbDeps & { lookup: { http: ZincHttp; key: string }; recordCost: RecordCost };

/**
 * `not_current`: the failure was fixed or replaced already (a stale tab). `not_open`: the round
 * no longer needs attention, is closed, or has reached its ship-by day, so nothing can be bought.
 * `zinc_off`: zinc_ordering_enabled isn't 1, so a re-buy would only be held (E7's off switch).
 */
export type QuoteResult =
  | { oldCents: number; newCents: number }
  | "not_allowed"
  | "not_current"
  | "not_open"
  | "unavailable"
  | "once"
  | "zinc_off";

/** replaceFailedOrder's own refusals, on top of approveAndBuy's. */
export type ReplaceError =
  /** The failed order is resolved, replaced already, or not a failure. */
  | "not_current"
  /** The price rose again above what the page showed (S1). */
  | "price_changed"
  /** This gift already had a price rise fixed (S2). */
  | "once"
  /** Today's price can't be looked up: gone, or priced from a list. */
  | "unavailable";

export type ReplaceResult = ApproveResult | { ok: false; error: ReplaceError };

export type ReplaceInput = {
  userId: string;
  roundId: string;
  failedOrderId: string;
  /** The failed order's own idea (a price rise or an address failure), or the next-best one. */
  ideaId: string;
  /** For a price-rise re-buy: the total the page showed from quoteFailedOrder. */
  shownTotalCents?: number;
  /** The "never more than" the page showed; required for a card buyer, as ApproveInput's. */
  shownMaxCents?: number;
  /** The failed order's ship-to when left out; an address failure needs a fixed address (AC-15a). */
  shipTo?: ShipTo;
  overBudgetConfirmed?: boolean;
};

const ADDRESS_FAILURES: readonly string[] = ["address_withdrawn", "address_rejected"];
/** Failures whose own gift can be quoted again and bought at today's price. */
const REQUOTED: readonly string[] = ["price_up", "card_needed"];

/** A failed order can still be replaced: the round needs attention, isn't closed, and today (UTC) is before its ship-by day. */
function canReplace(round: { status: string; closed_at: string | null; ship_by_deadline: string }, now: Date): boolean {
  return round.status === "needs_attention" && round.closed_at === null && now.toISOString().slice(0, 10) < round.ship_by_deadline;
}

/** Is this the buyer's own unresolved failure in this round? */
function isCurrentFailure(o: FailedOrderRow | null, userId: string, roundId: string): o is FailedOrderRow {
  return o !== null && o.user_id === userId && o.round_id === roundId && o.status === "failed" && !o.resolved;
}

/**
 * Today's estimated total for an idea (price, shipping, the tax estimate and the order fee,
 * as the idea run works it out) and its goods alone (the same without the fee), or null when
 * it can't be had. One paid lookup, logged as
 * `order.requote` with its cost, which is also recorded for the failed order and its buyer
 * whenever a call was made, whatever way it ends.
 */
async function requote(
  deps: QuoteDeps,
  idea: IdeaRow,
  feeCents: number,
  ids: Record<string, string>,
  bill: { userId: string; orderId: string },
): Promise<{ totalCents: number; goodsCents: number } | null> {
  const [taxPct, lookupCents, amazonFreeShippingFromCents, amazonShippingCents] = await Promise.all([
    setting(deps, "idea_tax_estimate_pct"),
    setting(deps, "zinc_lookup_cents"),
    setting(deps, "amazon_free_shipping_from_cents"),
    setting(deps, "amazon_shipping_estimate_cents"),
  ]);
  let calls = 0;
  // Every Zinc call is charged (counted at zinc_lookup_cents); there's one at most here.
  const step: ZincStep = async (call) => {
    calls++;
    return call();
  };
  let offer: ZincOffer | null = null;
  let outcome = "priced";
  try {
    const route = routeOf(idea);
    if (typeof route === "string") {
      outcome = route;
    } else {
      offer = await lookUp(deps.lookup, idea, route, { amazonFreeShippingFromCents, amazonShippingCents }, step);
      if (!offer) outcome = "unavailable";
    }
  } catch (e) {
    if (!(e instanceof ZincError)) throw e;
    outcome = `zinc_${e.kind}`;
  } finally {
    // Zinc reports no price per lookup, so the setting's is an estimate. A recorder that throws
    // (it shouldn't) can't change the quote or hide the error being rethrown.
    if (calls > 0) {
      const cost: Cost = { userId: bill.userId, kind: "lookup_price_check", cents: calls * lookupCents, estimated: true, orderId: bill.orderId };
      try {
        await deps.recordCost(cost);
      } catch {
        // Bookkeeping only.
      }
    }
  }
  const newCents = offer
    ? estimatedTotalCents({
        priceCents: offer.priceCents,
        shippingCents: offer.shippingCents,
        taxCents: Math.round((offer.priceCents * taxPct) / 100),
        feeCents,
      })
    : null;
  logEvent("order.requote", {
    ...ids,
    idea_id: idea.id,
    outcome,
    lookups: calls,
    cents: calls * lookupCents,
    ...(newCents !== null ? { old_cents: idea.est_total_cents, new_cents: newCents } : {}),
  });
  return newCents === null ? null : { totalCents: newCents, goodsCents: newCents - feeCents };
}

type Route = Extract<ListGiftRoute, { kind: "offers" | "details" }>;

/**
 * Where an idea's price is looked up today, or why it can't be (so nothing is called or
 * charged). An AI idea stores Zinc's own retailer name. A list gift stores the store's display
 * name, so it's routed by its link, as the idea run priced it, and refused when the link names
 * another product than the one priced.
 */
function routeOf(idea: IdeaRow): Route | "no_live_price" | "link_mismatch" | "other_marketplace" {
  const { retailer, retailer_product_id: productId, product_url: url } = idea;
  if (!productId) return "no_live_price";
  if (idea.source !== "list") {
    return retailer === "amazon" || retailer === "walmart" ? { kind: "offers", retailer, productId } : "no_live_price";
  }
  if (!url) return "no_live_price";
  // On an Amazon link the saved id is the ASIN the run priced.
  const route = listGiftRoute(url, productId);
  if (route.kind === "check") return "no_live_price";
  if (route.kind === "refused") return route.reason;
  // An Amazon route has already matched the saved ASIN, whatever its case.
  return route.retailer === "amazon" || route.productId === productId ? route : "link_mismatch";
}

/** The idea's product at its store today (R1); null when it's gone or has no usable price. */
async function lookUp(lookup: QuoteDeps["lookup"], idea: IdeaRow, route: Route, ship: AmazonShipping, step: ZincStep): Promise<ZincOffer | null> {
  const { productId } = route;
  const signal = new AbortController().signal;
  if (route.kind === "offers") {
    const offers = await step(() => productOffers(lookup.http, lookup.key, route.retailer, productId, ship, signal));
    if (offers === "stop") return null;
    const own = idea.offer_id === null ? undefined : offers.find((o) => o.offerId === idea.offer_id);
    // The idea's own seller when it still sells it new; otherwise the best offer, as the run picks.
    return (own && pickOffer([own])) ?? pickOffer(offers);
  }
  // Zinc names a Shopify store by its domain.
  const zincRetailer = route.retailer === "shopify" ? route.shop : route.retailer;
  const d = await step(() => productDetails(lookup.http, lookup.key, zincRetailer, productId, signal));
  if (d === "stop" || d === null) return null;
  if (!(d.productId === productId || d.handle === productId) || d.priceCents === null || d.available === false) return null;
  return {
    offerId: null,
    priceCents: d.priceCents,
    shippingCents: d.shippingCents ?? 0,
    available: true,
    condition: "New",
    buyBox: true,
    firstParty: false,
    sellerName: null,
    handlingDaysMax: 0,
    deliveryDaysMin: d.deliveryDaysMax ?? 0,
    deliveryDaysMax: d.deliveryDaysMax ?? 0,
  };
}

/**
 * Today's price for a gift that failed with price_up or card_needed (AC-14): read-only, one paid
 * lookup, inside the paid-features check. Only on the buyer's tap, never on load (AC-4a). Both
 * figures are what the gift costs this buyer: a card buyer's whole charge at today's fees.
 */
export async function quoteFailedOrder(input: { userId: string; roundId: string; orderId: string }, deps: QuoteDeps): Promise<QuoteResult> {
  const { userId, roundId, orderId } = input;
  const ids = { round_id: roundId, user_id: userId, order_id: orderId };
  const round = await readRound(deps, roundId);
  if (!round || round.user_id !== userId) return "not_allowed";
  const failed = await readOrder(deps, orderId);
  if (!failed || failed.user_id !== userId || failed.round_id !== roundId) return "not_allowed";
  // Nothing can be bought on it any more, so no paid lookup.
  if (!canReplace(round, deps.now)) return "not_open";
  if (!isCurrentFailure(failed, userId, roundId)) return "not_current";
  if (!REQUOTED.includes(failed.failure_type ?? "")) return "not_allowed";
  if (!(await hasPaidFeatures(deps.db, userId))) return "not_allowed";
  // Stop all ordering stops this paid lookup too: a re-buy would only be held as paused.
  if ((await setting(deps, "zinc_ordering_enabled")) !== 1) return "zinc_off";
  // Once per gift for a price rise (S2); a card that couldn't be charged may be tried again.
  if (failed.failure_type === "price_up" && (await priceRiseFixed(deps, failed.idea_id, failed.id))) return "once";
  const idea = (await readIdeas(deps, [failed.idea_id])).get(failed.idea_id);
  if (!idea) return "unavailable";
  const [payer, feeCents] = await Promise.all([readPayer(deps, userId), setting(deps, "zinc_order_fee_cents")]);
  const today = await requote(deps, idea, feeCents, ids, { userId, orderId });
  if (today === null) return "unavailable";
  return { oldCents: ideaTotalCents(idea, payer), newCents: totalFor(today, payer) };
}

/**
 * A card buyer's "Most you'll pay" for replacing a failed gift with one whose whole charge today is
 * `totalCents`, worked out as replaceFailedOrder will (the round's other live orders counted, the
 * over-budget allowance said yes to), so the fix page can show it and send it back as
 * `shownMaxCents`. Null for a wallet buyer, or when it's past the allowance. Only reads.
 */
export async function replacementMaxCents(
  deps: DbDeps,
  input: { userId: string; roundId: string; failedOrderId: string; totalCents: number },
): Promise<number | null> {
  const payer = await readPayer(deps, input.userId);
  if (payer.mode !== "connect") return null;
  const [round, account, orders, marginPct] = await Promise.all([
    readRound(deps, input.roundId),
    readAccount(deps, input.userId),
    liveOrders(deps, input.roundId),
    setting(deps, "order_price_margin_pct"),
  ]);
  if (!round || round.user_id !== input.userId || !account) return null;
  const committed = committedSpendCents(orders.filter((o) => o.id !== input.failedOrderId).map(asCommitted));
  const fit = capsForPayer(round, [input.totalCents], account, true, payer, marginPct, committed);
  return typeof fit === "string" ? null : fit.neverMoreThanCents;
}

/**
 * `lookup` is null where the app's key isn't set: only a price-rise re-buy needs it. The re-check's
 * cost is written after the round lease is let go, so recording can't hold the round.
 */
export async function replaceFailedOrder(input: ReplaceInput, deps: PurchaseDeps & { lookup: QuoteDeps["lookup"] | null; recordCost: RecordCost }): Promise<ReplaceResult> {
  const costs: Cost[] = [];
  try {
    return await replaceUnderLease(input, { ...deps, recordCost: async (cost) => void costs.push(cost) });
  } finally {
    await Promise.allSettled(costs.map(async (cost) => deps.recordCost(cost)));
  }
}

/**
 * Replaces one failed order (AC-14, AC-15, AC-15a): with the next-best idea, the same gift at
 * today's price (once, and never above what the page showed), or the same gift to a fixed
 * address. Under the round lease, read again; then the budget check and caps with the other
 * live orders counted, replace_failed_order, placing, and telling the buyer.
 */
async function replaceUnderLease(input: ReplaceInput, deps: PurchaseDeps & { lookup: QuoteDeps["lookup"] | null; recordCost: RecordCost }): Promise<ReplaceResult> {
  const { userId, roundId } = input;
  const ids = { round_id: roundId, user_id: userId, order_id: input.failedOrderId };

  // Only the buyer's own round is ever leased, and nothing paid runs without paid features.
  const owned = await readRound(deps, roundId);
  if (!owned || owned.user_id !== userId) return { ok: false, error: "not_found" };
  if (!(await hasPaidFeatures(deps.db, userId))) return { ok: false, error: "not_allowed" };

  const lock = await claimRoundNow(deps, roundId);
  if (!lock) return { ok: false, error: "busy" };

  let several = false;
  const refused = await withLease(deps, roundId, lock, async (): Promise<ReplaceResult | null> => {
    // The round, the failure and the idea as they are now, before any paid lookup.
    const round = await readRound(deps, roundId);
    if (!round || round.user_id !== userId) return { ok: false, error: "not_found" };
    if (!canReplace(round, deps.now)) return { ok: false, error: "not_open" };
    const failed = await readOrder(deps, input.failedOrderId);
    if (!isCurrentFailure(failed, userId, roundId)) return { ok: false, error: "not_current" };
    const idea = (await readIdeas(deps, [input.ideaId])).get(input.ideaId);
    if (!idea || idea.round_id !== roundId) return { ok: false, error: "bad_ideas" };
    const same = idea.id === failed.idea_id;
    const addressFailure = ADDRESS_FAILURES.includes(failed.failure_type ?? "");
    const priceUp = same && failed.failure_type === "price_up";
    const cardNeeded = same && failed.failure_type === "card_needed";
    if (same ? !(priceUp || addressFailure || cardNeeded) : idea.status !== "proposed") return { ok: false, error: "replaced" };

    // What the gift costs this buyer: a card buyer's whole charge at today's fees (AC-5).
    const payer = await readPayer(deps, userId);
    let total = ideaTotalCents(idea, payer);
    let requoted: { totalCents: number; goodsCents: number } | null = null;
    // A price-rise re-buy: once per gift, at no more than the page showed (S1, S2).
    if (priceUp) {
      if (await priceRiseFixed(deps, idea.id, failed.id)) return { ok: false, error: "once" };
      if (input.shownTotalCents === undefined) return { ok: false, error: "price_changed" };
      if (!deps.lookup) return { ok: false, error: "unavailable" };
      requoted = await requote({ ...deps, lookup: deps.lookup }, idea, deps.settings.feeCents, ids, { userId, orderId: failed.id });
      if (requoted === null) return { ok: false, error: "unavailable" };
      total = totalFor(requoted, payer);
      if (total > input.shownTotalCents) return { ok: false, error: "price_changed" };
    }
    // A card that couldn't be charged: the same gift again at today's price, any number of times.
    // One that can't be quoted today keeps its saved estimate, capped as ever.
    if (cardNeeded && deps.lookup) {
      requoted = await requote({ ...deps, lookup: deps.lookup }, idea, deps.settings.feeCents, ids, { userId, orderId: failed.id });
      if (requoted !== null) total = totalFor(requoted, payer);
    }

    // The budget check and the cap, with the round's other live orders counted.
    const account = await readAccount(deps, userId);
    if (!account) return { ok: false, error: "not_allowed" };
    const others = (await liveOrders(deps, roundId)).filter((o) => o.id !== failed.id);
    several = others.length > 0;
    const committed = committedSpendCents(others.map(asCommitted));
    const fit = capsForPayer(round, [total], account, input.overBudgetConfirmed === true, payer, deps.settings.marginPct, committed);
    if (typeof fit === "string") return { ok: false, error: fit };
    const changed = shownTooLow(payer, fit.neverMoreThanCents, input.shownMaxCents);
    if (changed) {
      logEvent("order.replace_refused", { ...ids, reason: "price_changed" });
      return changed;
    }

    const dest = await replacementDestination(deps, failed, round.person_id, addressFailure, input.shipTo);
    if (!dest) return { ok: false, error: "no_address" };

    const { data, error } = await concierge(deps).rpc("replace_failed_order", {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_failed_order_id: failed.id,
      p_order: {
        idea_id: idea.id,
        ...moneyFields(payer, fit.caps[0]),
        gift_message: failed.gift_message,
        ship_to: dest.ship_to,
        address_source: dest.address_source,
        address_owner_id: dest.address_owner_id,
        address: dest.address,
        // The idea's saved price follows a re-quote: the wallet total, and for a card the goods alone.
        ...(priceUp && requoted ? { new_total_cents: requoted.totalCents } : {}),
        ...(cardNeeded && requoted ? { new_total_cents: requoted.totalCents, new_goods_cents: requoted.goodsCents } : {}),
      },
    });
    if (error) {
      const refusal = error.code === "P0001" ? REFUSALS[refusalOf(error.message, "replace_failed_order")] : undefined;
      if (!refusal) throw new Error(`Replacing the order failed: ${error.message}`);
      logEvent("order.replace_refused", { ...ids, reason: refusal });
      return { ok: false, error: refusal };
    }
    const fresh = (data ?? [])[0];
    logEvent("order.replaced", { ...ids, new_order_id: fresh?.id ?? null, idea_id: idea.id, max_price_cents: fit.caps[0] });
    await saveDestination(deps, userId, round.person_id, dest, ids);
    await placeRound(roundId, lock, deps);
    return null;
  });
  if (refused) return refused;
  return tellCustomer(deps, roundId, { round_id: roundId, user_id: userId }, several);
}

/** What a re-quote costs this buyer: the wallet total, or the whole card charge at today's fees. */
function totalFor(q: { totalCents: number; goodsCents: number }, payer: Payer): number {
  return ideaTotalCents({ goods_cents: q.goodsCents, est_total_cents: q.totalCents }, payer);
}

/** replace_failed_order's refusals; "no new total" is a programming error and throws. */
const REFUSALS: Record<string, ApproveError | ReplaceError> = {
  ...CARD_REFUSALS,
  "lease not held": "busy",
  "not open": "not_open",
  "not current": "not_current",
  replaced: "replaced",
  once: "once",
  "fixed address": "no_address",
  // The person was relinked after the address was read (T88); trying again reads it afresh.
  "address changed": "busy",
  not_shared: "not_shared",
  already_bought: "already_bought",
  claimed: "claimed",
};

/**
 * Where the replacement ships. An address failure (AC-15a, T61) goes to a fixed address: the
 * buyer's, another one, or (asked as "recipient") the person's own address read now, only
 * while no list owner shares one; never to the recipient again. Otherwise the choice given, or
 * the failed order's own: the recipient read now, or its saved snapshot.
 */
async function replacementDestination(
  deps: PurchaseDeps,
  failed: FailedOrderRow,
  personId: string,
  addressFailure: boolean,
  shipTo: ShipTo | undefined,
): Promise<Destination | null> {
  const userId = failed.user_id;
  if (addressFailure) {
    if (shipTo && shipTo.kind !== "recipient") return destinationFor(deps, userId, personId, shipTo);
    const own = await recipientAddress(deps, personId);
    if (!own || own.source !== "own" || !isShippableAddress(own.draft)) return null;
    // Never back to the address the store refused, even when the person's own entry is the same.
    if (failed.failure_type === "address_rejected") {
      const refused = (await savedSnapshots(deps, [failed.id])).get(failed.id);
      if (refused && sameAddress(refused, own.snapshot)) return null;
    }
    return { ship_to: "other", address_source: "own", address_owner_id: null, address: own.snapshot };
  }
  if (shipTo) return destinationFor(deps, userId, personId, shipTo);
  if (failed.ship_to === "recipient") return destinationFor(deps, userId, personId, { kind: "recipient" });
  const saved = (await savedSnapshots(deps, [failed.id])).get(failed.id);
  return saved
    ? {
        ship_to: failed.ship_to as Destination["ship_to"],
        address_source: (failed.address_source ?? "own") as AddressSource,
        address_owner_id: failed.address_owner_id,
        address: saved,
      }
    : null;
}

/** The same place to ship to: names and address lines, ignoring case and spacing (not the phone). */
function sameAddress(a: AddressSnapshot, b: AddressSnapshot): boolean {
  const keys = ["recipient_first_name", "recipient_last_name", "address_line1", "address_line2", "city", "state", "zip", "country"] as const;
  const norm = (v: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return keys.every((k) => norm(a[k]) === norm(b[k]));
}
