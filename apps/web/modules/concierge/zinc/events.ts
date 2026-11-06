// Zinc webhooks (ALL-32 AC-13, AC-14, AC-26). Each user's own Zinc account posts
// to /api/zinc/webhook/<their webhook id>; the signature is checked with that
// account's secret, so one user can't forge events for another. Order events
// only ever settle that user's own order, and only while it is placing or
// unconfirmed, so a duplicate or late event changes nothing. Logs carry ids only (E6).
import { z } from "zod";
import { logEvent } from "@/lib/log";
import { call } from "./client";
import { parseEvent, verifySignature, type ZincEvent } from "./signature";
import type { PlaceHeld, ZincDeps } from "./types";

type Deps = ZincDeps & { placeHeld: PlaceHeld };

const uuid = z.string().uuid();
const secretRow = z.object({ user_id: z.string(), webhook_secret: z.string() });
const priceParts = z
  .object({ subtotal: z.number(), shipping: z.number(), tax: z.number(), total: z.number() })
  .partial();
const placedData = z.object({ data: z.object({ price_components: priceParts.nullish() }).nullish() });
const zincOrder = z.object({ metadata: z.record(z.string(), z.unknown()).nullish() });
const keyRow = z.object({ api_key: z.string().nullable() });

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

  if (event.event === "order.placed" || event.event === "order.failed") {
    await settle(userId, event, deps);
  } else if (event.event === "wallet.auto_topup.succeeded") {
    await setAutoTopup(userId, true, deps);
    await deps.placeHeld(userId);
  } else if (event.event === "wallet.auto_topup.disabled") {
    await setAutoTopup(userId, false, deps);
  } else if (event.event === "wallet.auto_topup.failed") {
    // The user's own Zinc account tried and could not; the setting stays as it was.
    logEvent("zinc.auto_topup_failed", { user_id: userId });
  }
  return { status: 200 };
}

async function setAutoTopup(userId: string, on: boolean, deps: Deps): Promise<void> {
  const { error } = await deps.db.schema("concierge").from("accounts").update({ auto_topup_on: on }).eq("user_id", userId);
  if (error) throw new Error("Saving the auto top-up setting failed.");
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
  const key = keyRow.safeParse(keys.data?.[0]);
  if (!key.success || !key.data.api_key) return null;
  try {
    const order = await call(deps.http, "GET", `/orders/${encodeURIComponent(zincOrderId)}`, zincOrder, { key: key.data.api_key });
    const ref = uuid.safeParse(order.metadata?.order_id);
    return ref.success ? ref.data : null;
  } catch {
    return null;
  }
}

// Zinc's error_type to the failure types our SQL understands; anything else is a plain failure.
function failureType(errorType: string | undefined): string {
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
    // The tick's stale sweep settles it later.
    logEvent("zinc.webhook_unmatched", { user_id: userId, provider_order_id: event.orderId });
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

  const placed = event.event === "order.placed";
  let price: Record<string, string | number> = { provider_order_id: event.orderId };
  if (placed) {
    const parts = placedData.safeParse(event.raw);
    const c = parts.success ? parts.data.data?.price_components : null;
    price = {
      ...price,
      ...(c?.subtotal !== undefined ? { subtotal_cents: c.subtotal } : {}),
      ...(c?.shipping !== undefined ? { shipping_cents: c.shipping } : {}),
      ...(c?.tax !== undefined ? { tax_cents: c.tax } : {}),
      ...(c?.total !== undefined ? { total_cents: c.total } : {}),
    };
  }
  const { error } = await concierge.rpc("settle_order", {
    p_user_id: userId,
    p_order_id: order.id,
    p_status: placed ? "placed" : "failed",
    p_failure_type: placed ? (null as unknown as string) : failureType(event.errorType),
    p_price: price,
  });
  if (error) throw new Error(`Settling the order failed (${error.code}).`);
  logEvent("zinc.order_settled", { user_id: userId, order_id: order.id, status: placed ? "placed" : "failed" });
}
