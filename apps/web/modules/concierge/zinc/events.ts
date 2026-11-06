// Zinc webhooks (ALL-32 AC-13, AC-14, AC-26). Each user's own Zinc account posts
// to /api/zinc/webhook/<their webhook id>; the signature is checked with that
// account's secret, so one user can't forge events for another. Order events
// only ever settle that user's own order, and only while it is placing or
// unconfirmed, so a duplicate or late event changes nothing. Logs carry ids only (E6).
import { z } from "zod";
import { errorFields, logEvent } from "@/lib/log";
import { call, ZincError } from "./client";
import { parseEvent, verifySignature, type ZincEvent } from "./signature";
import type { PlaceHeld, ZincDeps } from "./types";

type Deps = ZincDeps & {
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

const uuid = z.string().uuid();
const secretRow = z.object({ user_id: z.string(), webhook_secret: z.string() });
// Whole cents that fit the database's integer columns; anything else is a bad price block.
const cents = z.number().int().nonnegative().max(2_147_483_647);
const priceParts = z.object({ subtotal: cents, shipping: cents, tax: cents, total: cents }).partial();
const placedData = z.object({ data: z.object({ price_components: z.unknown() }).nullish() });
const zincOrder = z.object({ metadata: z.record(z.string(), z.unknown()).nullish() });
const keyRow = z.object({ api_key: z.string().nullable() });

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

  let event: ZincEvent;
  try {
    event = parseEvent(JSON.parse(rawBody));
  } catch {
    logEvent("zinc.webhook_invalid", { user_id: userId });
    return { status: 200 };
  }

  try {
    if (event.event === "order.placed" || event.event === "order.failed") {
      await settle(userId, event, deps);
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

/** Zinc's timestamps are UTC and may lack the Z. Null when absent or unreadable. */
function eventTime(timestamp: string | undefined): string | null {
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

/** Our order id for a Zinc order id: the row that holds it, else the reference we sent Zinc in metadata. */
async function findOurOrder(userId: string, zincOrderId: string, deps: Deps): Promise<string | null> {
  const concierge = deps.db.schema("concierge");
  const { data, error } = await concierge
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("provider_order_id", zincOrderId)
    .limit(1);
  if (error) throw new Error("Looking up the order failed.");
  if (data?.[0]) return data[0].id;

  // The webhook carries only Zinc's order id. Our row may not have it yet (a crash between
  // sending and saving), so ask Zinc for the order and read back our own reference.
  const keys = await concierge.rpc("zinc_secrets", { p_user_id: userId });
  if (keys.error) throw new Error("Reading the Zinc key failed.");
  const key = keyRow.safeParse(keys.data?.[0]);
  if (!key.success || !key.data.api_key) return null;
  try {
    const order = await call(deps.http, "GET", `/orders/${encodeURIComponent(zincOrderId)}`, zincOrder, { key: key.data.api_key });
    const ref = uuid.safeParse(order.metadata?.order_id);
    return ref.success ? ref.data : null;
  } catch (error) {
    // Timeouts, 5xx and 429 are worth a Zinc retry; a definitive miss (404, 401) is not.
    if (error instanceof ZincError && error.kind === "unavailable") throw error;
    return null;
  }
}

// Zinc's error_type to the failure types our SQL understands; anything else is a plain failure.
export function failureType(errorType: string | undefined): string {
  if (errorType === "max_price_exceeded") return "price_up";
  if (errorType === "out_of_stock" || errorType === "invalid_shipping_address") return errorType;
  return "failed";
}

async function settle(userId: string, event: ZincEvent, deps: Deps): Promise<void> {
  if (!event.orderId) {
    logEvent("zinc.webhook_unmatched", { user_id: userId, reason: "no_order_id" });
    return;
  }
  const ourId = await findOurOrder(userId, event.orderId, deps);
  if (!ourId) {
    // Zinc answered definitively that it has no such order for this key, or the reference is
    // missing: the owner settles it by hand (design/operations.md > Alerts).
    logEvent("zinc.webhook_unmatched", { user_id: userId, provider_order_id: event.orderId, alert: true });
    return;
  }
  const concierge = deps.db.schema("concierge");
  const found = await concierge.rpc("order_by_reference", { p_user_id: userId, p_order_id: ourId });
  if (found.error) throw new Error("Looking up the order failed.");
  const order = found.data?.[0];
  if (!order || (order.status !== "placing" && order.status !== "unconfirmed")) {
    logEvent("zinc.webhook_ignored", { user_id: userId, order_id: order?.id ?? null, status: order?.status ?? null });
    return;
  }

  if (order.provider_order_id && order.provider_order_id !== event.orderId) {
    logEvent("zinc.webhook_provider_id_mismatch", { user_id: userId, order_id: order.id });
    return;
  }

  const placed = event.event === "order.placed";
  let price: Record<string, string | number> = { provider_order_id: event.orderId };
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
  }
  const { data: roundStatus, error } = await concierge.rpc("settle_order", {
    p_user_id: userId,
    p_order_id: order.id,
    p_status: placed ? "placed" : "failed",
    p_failure_type: placed ? "failed" : failureType(event.errorType),
    p_price: price,
  });
  if (error) throw new Error(`Settling the order failed (${error.code}).`);
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
