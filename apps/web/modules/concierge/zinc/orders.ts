import { z } from "zod";
import { logEvent } from "@/lib/log";
import { parseBody, send, ZincError, type ZincHttp } from "./client";
import type { FoundOrder, PlacedPrice, ZincOrderInput } from "./types";

/**
 * The app's own Zinc key, the one card orders are placed with. It's on the same Zinc account as
 * the owner's wallet, and an order sent without `payment` is paid from that wallet. So the key's
 * value is readable only in this file: it can create an order only through sendConnectOrder,
 * which refuses a body without the payment, and look one up through findOrderByReference.
 * Serialized or logged, the handle shows no key.
 */
export type ConnectKey = { readonly kind: "zinc_connect_key" };

const appKeys = new WeakMap<ConnectKey, string>();

export function connectKey(value: string): ConnectKey {
  const handle: ConnectKey = Object.freeze({ kind: "zinc_connect_key" as const, toString: () => "[zinc connect key]" });
  appKeys.set(handle, value);
  return handle;
}

/** The key's value for a request, or null for a handle connectKey didn't make. */
function keyValue(key: string | ConnectKey): string | null {
  return typeof key === "string" ? key : (appKeys.get(key) ?? null);
}

export type CreateOrderResult =
  | { providerOrderId: string }
  | { insufficient: { requiredCents: number; availableCents: number } }
  | { exists: true };

const idempotencyKey = z.string().min(1).max(36);
const created = z.object({ id: z.string() });
const shortfall = z.object({ required: z.number(), available: z.number() });

function notSent(code: string): ZincError {
  return new ZincError("rejected", 0, `Zinc POST /orders not sent (${code})`, code);
}

function orderBody(o: ZincOrderInput) {
  if (!idempotencyKey.safeParse(o.idempotencyKey).success) throw notSent("invalid_idempotency_key");
  return {
    products: [{ url: o.productUrl, quantity: 1 }],
    max_price: o.maxPriceCents,
    shipping_address: {
      first_name: o.shipTo.firstName,
      last_name: o.shipTo.lastName,
      address_line1: o.shipTo.line1,
      ...(o.shipTo.line2 ? { address_line2: o.shipTo.line2 } : {}),
      city: o.shipTo.city,
      state: o.shipTo.state,
      postal_code: o.shipTo.postalCode,
      country: o.shipTo.country,
      phone_number: o.phone,
    },
    is_gift: true,
    fulfillment: { gift: "best_effort" },
    ...(o.giftMessage ? { gift_message: o.giftMessage } : {}),
    idempotency_key: o.idempotencyKey,
    metadata: { order_id: o.reference },
  };
}

const payment = z.object({
  mode: z.literal("connect"),
  paymentMethod: z.string().min(1),
  customer: z.string().min(1),
  marginCents: z.number().int().nonnegative(),
});

/**
 * Creates a card order on the app's key: the only way that key creates anything. Throws before
 * any request unless the body has `payment.mode` connect with a customer, a card and the margin.
 * A 402 is a rejection carrying Zinc's code (a declined card, failureTypeFor), never a wallet
 * shortfall: this account's wallet must never pay for a card order.
 */
export async function sendConnectOrder(h: ZincHttp, key: ConnectKey, o: ZincOrderInput): Promise<{ providerOrderId: string } | { exists: true }> {
  const value = keyValue(key);
  if (!value) throw notSent("app_key_missing");
  const p = payment.safeParse(o.payment);
  if (!p.success) throw notSent("payment_missing");
  const body = {
    ...orderBody(o),
    // max_price stays the goods cap: Zinc adds the margin and fees on top.
    payment: { mode: "connect", payment_method: p.data.paymentMethod, customer: p.data.customer, margin: { type: "flat", value: p.data.marginCents } },
  };
  const r = await send(h, "POST", "/orders", { key: value, body, tolerate: [409] });
  if (r.status === 409 && r.code === "already_exists") return { exists: true };
  if (r.status === 409) parseBody(z.never(), undefined, "POST", "/orders", r.status);
  return createdId(r);
}

function createdId(r: { status: number; json: unknown }): { providerOrderId: string } {
  const c = created.safeParse(r.json);
  // A 2xx we cannot read may still be a placed order: report it as ambiguous so the
  // caller looks it up by reference before any resend.
  if (!c.success) {
    throw new ZincError("unavailable", r.status, `Zinc POST /orders failed (${r.status} malformed_response)`, "malformed_response");
  }
  return { providerOrderId: c.data.id };
}

/** A wallet order, on the buyer's own key. It never carries a payment. */
export async function createOrder(h: ZincHttp, key: string, o: ZincOrderInput): Promise<CreateOrderResult> {
  const path = "/orders";
  if (o.payment != null) throw notSent("payment_on_wallet_order");
  const body = orderBody(o);
  const r = await send(h, "POST", path, { key, body, tolerate: [402, 409] });
  if (r.status === 409 && r.code === "already_exists") return { exists: true };
  if (r.status === 402) {
    const d = parseBody(shortfall, r.details, "POST", path, r.status);
    return { insufficient: { requiredCents: d.required, availableCents: d.available } };
  }
  if (r.status === 409) parseBody(z.never(), undefined, "POST", path, r.status);
  return createdId(r);
}

// Whole cents that fit the database's integer columns; a bad price block is left out, the status still counts.
const cents = z.number().int().nonnegative().max(2_147_483_647);
const priceParts = z.object({ subtotal: cents, shipping: cents, tax: cents, total: cents }).partial();

const list = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      job_result: z
        .object({ success: z.boolean().optional(), error_type: z.string().nullish(), price_components: z.unknown().optional() })
        .nullish(),
      connect: z.object({ final_charge: z.unknown().optional() }).nullish(),
    }),
  ),
});

/** Looks the order up by our reference (metadata.order_id). Null if Zinc has none. */
export async function findOrderByReference(h: ZincHttp, key: string | ConnectKey, reference: string): Promise<FoundOrder | null> {
  const value = keyValue(key);
  if (!value) throw new ZincError("rejected", 0, "Zinc GET /orders not sent (app_key_missing)", "app_key_missing");
  const reply = await send(h, "GET", "/orders", {
    key: value,
    query: { metadata_key: "order_id", metadata_value: reference },
  });
  // A 2xx we can't read says nothing about the order: unavailable (look again later), never rejected.
  const parsed = list.safeParse(reply.json);
  if (!parsed.success) {
    throw new ZincError("unavailable", reply.status, `Zinc GET /orders failed (${reply.status} malformed_response)`, "malformed_response");
  }
  const o = parsed.data.orders[0];
  if (!o) return null;
  const jr = o.job_result;
  if (o.status === "order_failed" || jr?.success === false) {
    return { providerOrderId: o.id, status: "failed", ...(jr?.error_type ? { errorType: jr.error_type } : {}) };
  }
  if (o.status === "order_placed" || jr?.success === true) {
    const charge = cents.safeParse(o.connect?.final_charge);
    const extra = charge.success ? { finalChargeCents: charge.data } : {};
    const p = priceParts.safeParse(jr?.price_components);
    if (!p.success || Object.keys(p.data).length === 0) return { providerOrderId: o.id, status: "placed", ...extra };
    const price = {
      ...(p.data.subtotal !== undefined ? { subtotalCents: p.data.subtotal } : {}),
      ...(p.data.shipping !== undefined ? { shippingCents: p.data.shipping } : {}),
      ...(p.data.tax !== undefined ? { taxCents: p.data.tax } : {}),
      ...(p.data.total !== undefined ? { totalCents: p.data.total } : {}),
    };
    return { providerOrderId: o.id, status: "placed", price, ...extra };
  }
  return { providerOrderId: o.id, status: "pending" };
}

/**
 * A placed order's prices, as settle_order takes them. On a card order `final_charge_cents` is
 * what the card was charged (connect.final_charge, assumption A7); without it settle_order works
 * the charge out from the saved fees.
 */
export function placedPrice(found: FoundOrder): PlacedPrice {
  const p = found.price;
  return {
    provider_order_id: found.providerOrderId,
    ...(p?.subtotalCents !== undefined ? { subtotal_cents: p.subtotalCents } : {}),
    ...(p?.shippingCents !== undefined ? { shipping_cents: p.shippingCents } : {}),
    ...(p?.taxCents !== undefined ? { tax_cents: p.taxCents } : {}),
    ...(p?.totalCents !== undefined ? { total_cents: p.totalCents } : {}),
    ...(found.finalChargeCents !== undefined ? { final_charge_cents: found.finalChargeCents } : {}),
  };
}

/**
 * Zinc charged a card more than the most the buyer approved: the owner is alerted (planning 66:
 * alert only until a real order shows it happens). Only Zinc's own figure counts; an estimate
 * from the saved fees can't pass the maximum.
 */
export function alertIfOver(
  order: { id: string; round_id: string; user_id: string; max_charge_cents: number | null },
  price: PlacedPrice,
): void {
  if (order.max_charge_cents === null || price.final_charge_cents === undefined) return;
  if (price.final_charge_cents <= order.max_charge_cents) return;
  logEvent("order.over_max_charge", {
    order_id: order.id,
    round_id: order.round_id,
    user_id: order.user_id,
    charge_cents: price.final_charge_cents,
    max_charge_cents: order.max_charge_cents,
    alert: true,
  });
}
