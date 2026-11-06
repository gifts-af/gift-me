import { z } from "zod";
import { parseBody, send, ZincError, type ZincHttp } from "./client";
import type { FoundOrder, ZincOrderInput } from "./types";

export type CreateOrderResult =
  | { providerOrderId: string }
  | { insufficient: { requiredCents: number; availableCents: number } }
  | { exists: true };

const idempotencyKey = z.string().min(1).max(36);
const created = z.object({ id: z.string() });
const shortfall = z.object({ required: z.number(), available: z.number() });

export async function createOrder(h: ZincHttp, key: string, o: ZincOrderInput): Promise<CreateOrderResult> {
  const path = "/orders";
  if (!idempotencyKey.safeParse(o.idempotencyKey).success) {
    throw new ZincError("rejected", 0, "Zinc POST /orders not sent (invalid idempotency key)", "invalid_idempotency_key");
  }
  const body = {
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
  const r = await send(h, "POST", path, { key, body, tolerate: [402, 409] });
  if (r.status === 409 && r.code === "already_exists") return { exists: true };
  if (r.status === 402) {
    const d = parseBody(shortfall, r.details, "POST", path, r.status);
    return { insufficient: { requiredCents: d.required, availableCents: d.available } };
  }
  if (r.status === 409) parseBody(z.never(), undefined, "POST", path, r.status);
  const c = created.safeParse(r.json);
  // A 2xx we cannot read may still be a placed order: report it as ambiguous so the
  // caller looks it up by reference before any resend.
  if (!c.success) {
    throw new ZincError("unavailable", r.status, `Zinc POST /orders failed (${r.status} malformed_response)`, "malformed_response");
  }
  return { providerOrderId: c.data.id };
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
        .object({ success: z.boolean().optional(), error_type: z.string().optional(), price_components: z.unknown().optional() })
        .nullish(),
    }),
  ),
});

/** Looks the order up by our reference (metadata.order_id). Null if Zinc has none. */
export async function findOrderByReference(h: ZincHttp, key: string, reference: string): Promise<FoundOrder | null> {
  const reply = await send(h, "GET", "/orders", {
    key,
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
    const p = priceParts.safeParse(jr?.price_components);
    if (!p.success || Object.keys(p.data).length === 0) return { providerOrderId: o.id, status: "placed" };
    const price = {
      ...(p.data.subtotal !== undefined ? { subtotalCents: p.data.subtotal } : {}),
      ...(p.data.shipping !== undefined ? { shippingCents: p.data.shipping } : {}),
      ...(p.data.tax !== undefined ? { taxCents: p.data.tax } : {}),
      ...(p.data.total !== undefined ? { totalCents: p.data.total } : {}),
    };
    return { providerOrderId: o.id, status: "placed", price };
  }
  return { providerOrderId: o.id, status: "pending" };
}
