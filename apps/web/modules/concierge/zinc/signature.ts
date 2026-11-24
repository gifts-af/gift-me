import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Zinc signs the raw body with HMAC-SHA256 (hex) using the account's webhook secret. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const got = Buffer.from(header.trim().replace(/^sha256=/, ""), "utf8");
  const want = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

// Every event shares this schema, and one that fails to parse is never retried, so only the
// event name may reject it. A field of an unexpected type is left out instead (E4).
const text = z.string().optional().catch(undefined);
const number = z.number().optional().catch(undefined);

// order_id is top level; error_type, the wallet fields and tracking live in `data`.
const eventData = z
  .object({
    error_type: text,
    error: text,
    amount_cents: number,
    status: text,
    // Checked package by package by packagesFromZinc, which keeps only whitelisted fields.
    tracking_numbers: z.unknown(),
    // calendarDay checks the estimate where it's used; refundCents checks the refund below.
    estimated_delivery: z.unknown(),
    refund_amount: z.unknown(),
  })
  .partial();

const event = z.object({
  event: z.string(),
  order_id: text,
  timestamp: text,
  data: eventData.optional().catch(undefined),
});

export type ZincEvent = {
  event: string;
  orderId?: string;
  /** When Zinc says the event happened (ISO 8601, sometimes without a Z; it is UTC). */
  timestamp?: string;
  /** order.failed */
  errorType?: string;
  /** order.failed, wallet.auto_topup.failed */
  error?: string;
  /** wallet.auto_topup.* */
  amountCents?: number;
  status?: string;
  /** order.tracking_received, order.shipped: Zinc's packages, unchecked. */
  trackingNumbers?: unknown;
  /** order.estimated_delivery_updated: the new estimate, unchecked. */
  estimatedDelivery?: unknown;
  /** order.cancelled: what Zinc refunded, in cents; null when it's missing or not a whole, non-negative number. */
  refundCents: number | null;
  raw: unknown;
};

/** Throws a ZodError on a body that is not an event. */
export function parseEvent(json: unknown): ZincEvent {
  const e = event.parse(json);
  return {
    event: e.event,
    orderId: e.order_id,
    timestamp: e.timestamp,
    errorType: e.data?.error_type,
    error: e.data?.error,
    amountCents: e.data?.amount_cents,
    status: e.data?.status,
    trackingNumbers: e.data?.tracking_numbers,
    estimatedDelivery: e.data?.estimated_delivery ?? undefined,
    refundCents: refundCents(e.data?.refund_amount),
    raw: json,
  };
}

function refundCents(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}
