// Zinc webhooks (ALL-32 AC-13, AC-14, AC-26). Each user's own Zinc account posts
// to /api/zinc/webhook/<their webhook id>; the signature is checked with that
// account's secret, so one user can't forge events for another. Order events
// only ever settle that user's own order, and only while it is placing or
// unconfirmed, so a duplicate or late event changes nothing. Logs carry ids only (E6).
//
// Card orders live on the app's own Zinc account, which posts to /api/zinc/webhook/app, signed
// with the app's secret. There the order is found first and the user comes from it, never from
// the body. Each webhook changes only its own kind of order: card orders at the app's, wallet
// orders at a buyer's. A wallet order on the app's webhook is ignored quietly, since one Zinc
// account can post both while the owner's wallet is still connected to it. A card order on a
// buyer's webhook is ignored too, but alerts: it means the app's webhook was replaced, and card
// orders then settle only through the sweep.
import { z } from "zod";
import { errorFields, logEvent } from "@/lib/log";
import { failureTypeFor, isAccountCode } from "./card-codes";
import { ZincError } from "./client";
import { alertIfOver, findOrderByReference, getOrder, placedPrice, type ConnectKey } from "./orders";
import { parseEvent, verifySignature, type ZincEvent } from "./signature";
import { handleTrackingEvent, TRACKING_EVENTS, type TrackingDeps } from "./tracking-events";
import type { PlacedPrice, PlaceHeld, ZincDeps } from "./types";

type Deps = TrackingDeps & {
  placeHeld: PlaceHeld;
  /**
   * The round engine's advanceRound, bound with justPlaced so it only tells the buyer and never
   * places inside Zinc's request: a settlement that needs the buyer is emailed at once (ALL-32).
   */
  advanceRound?: (roundId: string) => Promise<unknown>;
  /**
   * The engine's tellOrdered: the "ordered" email for an order Zinc confirmed placed, and the
   * "we couldn't buy it" email for one that failed after its round closed.
   */
  orderPlaced?: (roundId: string) => Promise<unknown>;
};

/** What handling one order event needs: everything but the wallet's placeHeld. */
type OrderDeps = Omit<Deps, "placeHeld">;

/**
 * Our order for a Zinc order id, as one webhook sees it: found (with the user it belongs to), an
 * order that is the other webhook's (`elsewhere`, with that order's way of paying: ignored), or a
 * definite miss (null: alerted). Throws when a lookup fails, so Zinc retries.
 */
export type OrderMatch = { orderId: string; userId: string } | { elsewhere: string } | null;

/** Which orders one webhook may change, and how it reads them at Zinc. */
export type WebhookScope = {
  /** The buyer whose own webhook it is; null on the app's, where the user comes from the order. */
  userId: string | null;
  mode: "zinc_wallet" | "connect";
  find: (zincOrderId: string) => Promise<OrderMatch>;
  /** The key that reads this webhook's orders at Zinc, or null when there is none. */
  key: () => Promise<string | ConnectKey | null>;
  /** Logged with an alert for a Zinc order we definitely don't have. */
  unknownEvent: "zinc.webhook_unmatched" | "zinc.unknown_order";
};

const uuid = z.string().uuid();
const secretRow = z.object({ user_id: z.string(), webhook_secret: z.string() });
// Whole cents that fit the database's integer columns; anything else is a bad price block.
const cents = z.number().int().nonnegative().max(2_147_483_647);
const priceParts = z.object({ subtotal: cents, shipping: cents, tax: cents, total: cents }).partial();
const placedData = z.object({ data: z.object({ price_components: z.unknown() }).nullish() });
const zincOrder = z.object({ metadata: z.record(z.string(), z.unknown()).nullish() });
const keyRow = z.object({ api_key: z.string().nullable() });
const matchRow = z.object({ id: z.string(), user_id: z.string(), funding_mode: z.string() });

// A missing Zinc env answers 404 before the signature is checked, deliberately: with Zinc off
// in this environment there is nothing to verify against (see the route).
/** Verifies and applies one webhook. 401 only for an unknown id or a bad signature; everything else is 200. */
export async function handleZincWebhook(
  webhookId: string,
  rawBody: string,
  signature: string | null,
  deps: Deps,
): Promise<{ status: 200 | 401 }> {
  if (!uuid.safeParse(webhookId).success) return { status: 401 };
  const { data, error } = await deps.db.schema("concierge").rpc("zinc_secret_by_webhook", { p_webhook_id: webhookId });
  if (error) throw new Error("Reading the Zinc webhook secret failed.");
  const parsed = secretRow.safeParse(data?.[0]);
  if (!parsed.success || !verifySignature(rawBody, signature, parsed.data.webhook_secret)) return { status: 401 };
  const userId = parsed.data.user_id;
  const scope: WebhookScope = {
    userId,
    mode: "zinc_wallet",
    find: (zincOrderId) => findOurOrder(userId, zincOrderId, deps),
    key: () => userZincKey(userId, deps),
    unknownEvent: "zinc.webhook_unmatched",
  };

  let event: ZincEvent;
  try {
    event = parseEvent(JSON.parse(rawBody));
  } catch {
    logEvent("zinc.webhook_invalid", { user_id: userId });
    return { status: 200 };
  }

  try {
    if (await handleOrderEvent(scope, event, deps)) {
      // Settled, cancelled or tracked.
    } else if (event.event === "wallet.auto_topup.succeeded") {
      if (await setAutoTopup(userId, true, event, deps)) await deps.placeHeld(userId);
    } else if (event.event === "wallet.auto_topup.disabled") {
      await setAutoTopup(userId, false, event, deps);
    } else if (event.event === "wallet.auto_topup.failed") {
      // The user's own Zinc account tried and could not; the setting stays as it was.
      logEvent("zinc.auto_topup_failed", { user_id: userId });
    }
  } catch (error) {
    // The route answers 500 so Zinc retries; the user id is only known here.
    logEvent("zinc.webhook_failed", { user_id: userId, ...errorFields(error) });
    throw error;
  }
  return { status: 200 };
}

/**
 * The app's own Zinc account: events for card orders. 401 only for a bad or missing signature;
 * everything else is 200, and a failure that a retry could fix throws (the route answers 500).
 * Wallet events and wallet orders are ignored here.
 */
export async function handleAppZincWebhook(
  rawBody: string,
  signature: string | null,
  deps: OrderDeps & { secret: string; connectKey: ConnectKey },
): Promise<{ status: 200 | 401 }> {
  if (!verifySignature(rawBody, signature, deps.secret)) return { status: 401 };
  let event: ZincEvent;
  try {
    event = parseEvent(JSON.parse(rawBody));
  } catch {
    logEvent("zinc.webhook_invalid", { webhook: "app" });
    return { status: 200 };
  }
  const scope: WebhookScope = {
    userId: null,
    mode: "connect",
    find: (zincOrderId) => findConnectOrder(zincOrderId, deps),
    key: async () => deps.connectKey,
    unknownEvent: "zinc.unknown_order",
  };
  if (!(await handleOrderEvent(scope, event, deps))) {
    logEvent("zinc.webhook_ignored", { webhook: "app", zinc_event: event.event, reason: "not_an_order_event" });
  }
  return { status: 200 };
}

/** Applies an order event (placed, failed, cancelled, tracking) within the webhook's scope. False for any other event. */
async function handleOrderEvent(scope: WebhookScope, event: ZincEvent, deps: OrderDeps): Promise<boolean> {
  if (event.event === "order.placed" || event.event === "order.failed") {
    await settle(scope, event, deps);
  } else if (event.event === "order.cancelled") {
    // Never behind order_tracking_enabled: money came back, so the buyer is always told.
    await storeCancelled(scope, event, deps);
  } else if (TRACKING_EVENTS.has(event.event)) {
    await handleTrackingEvent(scope, event, deps);
  } else {
    return false;
  }
  return true;
}

/** Zinc's timestamps are UTC and may lack the Z. Null when absent or unreadable. */
export function eventTime(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const t = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * Saves the auto top-up setting unless a newer wallet event was already applied (zinc retries
 * and out-of-order delivery). Returns whether it applied. Wallet events carry a timestamp; if one
 * has none (or an unreadable one) there is no way to order it, so it applies as it always did.
 * An event with the same time as the stored one is the same event again: harmless, so it applies.
 */
async function setAutoTopup(userId: string, on: boolean, event: ZincEvent, deps: Deps): Promise<boolean> {
  const at = eventTime(event.timestamp);
  let query = deps.db
    .schema("concierge")
    .from("accounts")
    .update({ auto_topup_on: on, ...(at ? { zinc_wallet_event_at: at } : {}) })
    .eq("user_id", userId);
  if (at) query = query.or(`zinc_wallet_event_at.is.null,zinc_wallet_event_at.lte.${at}`);
  const { data, error } = await query.select("user_id");
  if (error) throw new Error("Saving the auto top-up setting failed.");
  if (at && !data?.length) {
    logEvent("zinc.webhook_stale_wallet_event", { user_id: userId });
    return false;
  }
  return true;
}

/**
 * A buyer's wallet order for a Zinc order id: the row that holds it, else the reference we sent
 * Zinc in metadata. A card order, or another buyer's, is `elsewhere`.
 */
export async function findOurOrder(userId: string, zincOrderId: string, deps: ZincDeps): Promise<OrderMatch> {
  const asMatch = (row: MatchRow): OrderMatch =>
    row.user_id === userId && row.funding_mode === "zinc_wallet" ? { orderId: row.id, userId } : { elsewhere: row.funding_mode };
  const row = await rowByProviderId(zincOrderId, deps);
  if (row) return asMatch(row);
  const key = await userZincKey(userId, deps);
  if (!key) return null;
  const ref = await zincReference(deps, key, zincOrderId);
  if (!ref) return null;
  // With no row for the reference, order_by_reference finds nothing among this buyer's orders
  // and the event is ignored.
  const byRef = await rowByReference(ref, deps);
  return byRef ? asMatch(byRef) : { orderId: ref, userId };
}

/**
 * A card order for a Zinc order id on the app's webhook: the row that holds it, else the
 * reference read back from Zinc with the app's key. The user is the order's. A wallet order is
 * "elsewhere"; null is a definite miss. Throws when our database or Zinc can't answer.
 */
export async function findConnectOrder(
  zincOrderId: string,
  deps: Pick<ZincDeps, "db" | "http"> & { connectKey: ConnectKey },
): Promise<OrderMatch> {
  const asMatch = (row: MatchRow): OrderMatch =>
    row.funding_mode === "connect" ? { orderId: row.id, userId: row.user_id } : { elsewhere: row.funding_mode };
  const row = await rowByProviderId(zincOrderId, deps);
  if (row) return asMatch(row);
  const ref = await zincReference(deps, deps.connectKey, zincOrderId);
  if (!ref) return null;
  const byRef = await rowByReference(ref, deps);
  return byRef ? asMatch(byRef) : null;
}

type MatchRow = z.infer<typeof matchRow>;

/** Whichever of our orders a reference (its id, or an older idempotency key) names, any buyer's. */
async function rowByReference(ref: string, deps: Pick<ZincDeps, "db">): Promise<MatchRow | null> {
  // ref is a checked uuid, so it is safe inside the filter.
  const { data, error } = await deps.db
    .schema("concierge")
    .from("orders")
    .select("id, user_id, funding_mode")
    .or(`id.eq.${ref},idempotency_key.eq.${ref}`)
    .limit(1);
  if (error) throw new Error("Looking up the order failed.");
  const row = matchRow.safeParse(data?.[0]);
  return row.success ? row.data : null;
}

/**
 * An order of the other kind is ignored. A card order on a buyer's webhook also alerts: Zinc sends
 * card events to the app's webhook while it's registered, so the app's was replaced.
 */
function ignoreOther(scope: WebhookScope, event: ZincEvent, fundingMode: string, orderId: string | null): void {
  if (scope.mode === "zinc_wallet" && fundingMode === "connect") {
    logEvent("zinc.card_event_on_buyer_webhook", { user_id: scope.userId, order_id: orderId, zinc_event: event.event, alert: true });
    return;
  }
  logEvent("zinc.webhook_ignored", { user_id: scope.userId, order_id: orderId, zinc_event: event.event, reason: "other_webhook" });
}

/** Whichever of our orders holds this Zinc id, any buyer's. Throws when it can't be read. */
async function rowByProviderId(zincOrderId: string, deps: Pick<ZincDeps, "db">): Promise<MatchRow | null> {
  const { data, error } = await deps.db
    .schema("concierge")
    .from("orders")
    .select("id, user_id, funding_mode")
    .eq("provider_order_id", zincOrderId)
    .limit(1);
  if (error) throw new Error("Looking up the order failed.");
  const row = matchRow.safeParse(data?.[0]);
  return row.success ? row.data : null;
}

/**
 * Our reference (metadata.order_id) on Zinc's order, for a row that doesn't hold Zinc's id yet
 * (a crash between sending and saving). Timeouts, 5xx and 429 throw, worth a Zinc retry; a
 * definitive miss (404, 401) is null.
 */
async function zincReference(deps: Pick<ZincDeps, "http">, key: string | ConnectKey, zincOrderId: string): Promise<string | null> {
  try {
    const order = await getOrder(deps.http, key, zincOrderId, zincOrder);
    const ref = uuid.safeParse(order.metadata?.order_id);
    return ref.success ? ref.data : null;
  } catch (error) {
    if (error instanceof ZincError && error.kind === "unavailable") throw error;
    return null;
  }
}

/** The order columns the webhook handlers read. */
export type WebhookOrder = {
  id: string;
  round_id: string;
  user_id: string;
  status: string;
  funding_mode: string;
  provider_order_id: string | null;
  max_charge_cents: number | null;
};

/**
 * The webhook's order for an event, after the checks every order event shares: an id is given,
 * the order is found and is this webhook's kind, and the Zinc id it holds (if any) is the event's.
 * Null when the event stops here (logged); `order` is undefined when the reference matched no row.
 */
export async function loadOrder(
  scope: WebhookScope,
  event: ZincEvent,
  deps: Pick<ZincDeps, "db">,
): Promise<{ userId: string; zincOrderId: string; order: WebhookOrder | undefined } | null> {
  if (!event.orderId) {
    logEvent("zinc.webhook_unmatched", { user_id: scope.userId, reason: "no_order_id" });
    return null;
  }
  const match = await scope.find(event.orderId);
  if (match && "elsewhere" in match) {
    ignoreOther(scope, event, match.elsewhere, null);
    return null;
  }
  if (!match) {
    // Zinc answered definitively that it has no such order for this key, or the reference is
    // missing: the owner settles it by hand (design/operations.md > Alerts).
    logEvent(scope.unknownEvent, { user_id: scope.userId, provider_order_id: event.orderId, alert: true });
    return null;
  }
  const found = await deps.db.schema("concierge").rpc("order_by_reference", { p_user_id: match.userId, p_order_id: match.orderId });
  if (found.error) throw new Error("Looking up the order failed.");
  const order = found.data?.[0];
  if (order && order.funding_mode !== scope.mode) {
    ignoreOther(scope, event, order.funding_mode, order.id);
    return null;
  }
  if (order?.provider_order_id && order.provider_order_id !== event.orderId) {
    logEvent("zinc.webhook_provider_id_mismatch", { user_id: match.userId, order_id: order.id });
    return null;
  }
  return { userId: match.userId, zincOrderId: event.orderId, order };
}

/**
 * The prices an order settles as placed with. A wallet order takes what the event carries. A
 * card order also reads Zinc's order (by our reference, with the webhook's key) for what the
 * card was charged, so it's saved and checked against the maximum; what the read returns wins,
 * and the event's prices fill in any it lacks. A failed read throws and Zinc retries.
 */
export async function placedPriceFor(
  scope: WebhookScope,
  order: WebhookOrder,
  fromEvent: PlacedPrice,
  deps: Pick<ZincDeps, "http">,
): Promise<PlacedPrice> {
  if (scope.mode !== "connect") return fromEvent;
  const key = await scope.key();
  if (!key) throw new Error("No Zinc key to read the card order with.");
  const found = await findOrderByReference(deps.http, key, order.id);
  if (!found || found.status !== "placed") throw new Error(`Zinc's order isn't readable as placed (${found?.status ?? "none"}).`);
  return { ...fromEvent, ...placedPrice(found) };
}

/** After a card order settles as placed: the owner is alerted when Zinc charged above the maximum. */
export function checkCharge(scope: WebhookScope, order: WebhookOrder, price: PlacedPrice): void {
  if (scope.mode === "connect") alertIfOver(order, price);
}

/** The user's own Zinc API key, or null when they have none. Throws when it can't be read. */
export async function userZincKey(userId: string, deps: Pick<ZincDeps, "db">): Promise<string | null> {
  const keys = await deps.db.schema("concierge").rpc("zinc_secrets", { p_user_id: userId });
  if (keys.error) throw new Error("Reading the Zinc key failed.");
  const key = keyRow.safeParse(keys.data?.[0]);
  return key.success && key.data.api_key ? key.data.api_key : null;
}

/**
 * The store cancelled after placing, and Zinc refunded the wallet (store_cancel_order). Before
 * the ship-by date the buyer is told now through the failure path, with the fix page; on or
 * after it nothing is sent here, and the daily news tells it. A cancel that leaves every other
 * gift delivered sends the delivered email. Today is the UTC day of `now`, as in the engine.
 */
async function storeCancelled(scope: WebhookScope, event: ZincEvent, deps: OrderDeps): Promise<void> {
  const loaded = await loadOrder(scope, event, deps);
  if (!loaded) return;
  const { userId, order } = loaded;
  const concierge = deps.db.schema("concierge");
  const ids = { user_id: userId, order_id: order?.id ?? null, zinc_event: event.event };
  if (!order) {
    logEvent("tracking.event_ignored", { ...ids, status: null });
    return;
  }
  const { data, error } = await concierge.rpc("store_cancel_order", {
    p_user_id: userId,
    p_order_id: order.id,
    p_today: deps.now.toISOString().slice(0, 10),
    // What actually came back, for the emails; never our own total or cap. The generated types
    // mark every argument required; SQL reads null as "Zinc didn't say".
    p_refund_cents: event.refundCents as number,
  });
  if (error) throw new Error(`Cancelling the order failed (${error.code}).`);
  const result = data?.[0];
  if (!result?.applied) {
    const now = await concierge.rpc("order_by_reference", { p_user_id: userId, p_order_id: order.id });
    logEvent("tracking.event_ignored", { ...ids, status: now.data?.[0]?.status ?? order.status });
    return;
  }
  logEvent("tracking.store_cancelled", { user_id: userId, order_id: order.id, round_id: order.round_id, round_status: result.round_status });
  const tell =
    result.round_status === "needs_attention" ? deps.advanceRound : result.round_status === "delivered" ? deps.tellDelivered : undefined;
  if (!tell) return;
  try {
    await tell(order.round_id);
  } catch (e) {
    // The tick tells them instead; Zinc mustn't retry a cancel that's done.
    logEvent("tracking.store_cancel_tell_deferred", { user_id: userId, round_id: order.round_id, ...errorFields(e) });
  }
}

async function settle(scope: WebhookScope, event: ZincEvent, deps: OrderDeps): Promise<void> {
  const loaded = await loadOrder(scope, event, deps);
  if (!loaded) return;
  const { userId, zincOrderId, order } = loaded;
  const concierge = deps.db.schema("concierge");
  if (!order || (order.status !== "placing" && order.status !== "unconfirmed")) {
    logEvent("zinc.webhook_ignored", { user_id: userId, order_id: order?.id ?? null, status: order?.status ?? null });
    return;
  }

  const placed = event.event === "order.placed";
  let price: PlacedPrice = { provider_order_id: zincOrderId };
  if (placed) {
    const block = placedData.safeParse(event.raw);
    const raw = block.success ? block.data.data?.price_components : undefined;
    const parsedParts = raw === undefined || raw === null ? null : priceParts.safeParse(raw);
    if (parsedParts && !parsedParts.success) {
      // Saved without prices (the status still counts); a retry could never fix it.
      logEvent("zinc.webhook_bad_price", { user_id: userId, order_id: order.id });
    }
    const c = parsedParts?.success ? parsedParts.data : null;
    price = {
      ...price,
      ...(c?.subtotal !== undefined ? { subtotal_cents: c.subtotal } : {}),
      ...(c?.shipping !== undefined ? { shipping_cents: c.shipping } : {}),
      ...(c?.tax !== undefined ? { tax_cents: c.tax } : {}),
      ...(c?.total !== undefined ? { total_cents: c.total } : {}),
    };
    price = await placedPriceFor(scope, order, price, deps);
  }
  const errorType = typeof event.errorType === "string" ? event.errorType : undefined;
  if (!placed && event.errorType !== undefined && errorType === undefined) {
    // Settled as a plain failure: the order still failed, and a retry could never fix the reason.
    logEvent("zinc.webhook_bad_error_type", { user_id: userId, order_id: order.id });
  }
  const { data: roundStatus, error } = await concierge.rpc("settle_order", {
    p_user_id: userId,
    p_order_id: order.id,
    p_status: placed ? "placed" : "failed",
    p_failure_type: placed ? "failed" : failureTypeFor(errorType, order.funding_mode),
    p_price: price,
  });
  if (error) throw new Error(`Settling the order failed (${error.code}).`);
  if (placed) checkCharge(scope, order, price);
  if (!placed && order.funding_mode === "connect" && isAccountCode(errorType)) {
    // Our Zinc account, not the buyer's card: the owner fixes it (design/operations.md > Alerts).
    logEvent("zinc.connect_unauthorized", { user_id: userId, order_id: order.id, round_id: order.round_id, reason: "account", code: errorType, alert: true });
  }
  logEvent("zinc.order_settled", { user_id: userId, order_id: order.id, status: placed ? "placed" : "failed" });
  // Tell the buyer now, not at the next tick: the gift is ordered, or a failure needs them. A
  // failure on a round that already closed (any status) gets its own email through tellOrdered.
  const tells = placed
    ? [deps.orderPlaced]
    : [roundStatus === "needs_attention" ? deps.advanceRound : undefined, deps.orderPlaced];
  for (const tell of tells) {
    if (!tell) continue;
    try {
      await tell(order.round_id);
    } catch (e) {
      // The tick tells them instead; Zinc mustn't retry a settlement that's done.
      logEvent("order.hold_notice_deferred", { user_id: userId, round_id: order.round_id, ...errorFields(e) });
    }
  }
}
