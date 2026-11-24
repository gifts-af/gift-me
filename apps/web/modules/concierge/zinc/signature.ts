import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Zinc signs the raw body with HMAC-SHA256 (hex) using the account's webhook secret. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const got = Buffer.from(header.trim().replace(/^sha256=/, ""), "utf8");
  const want = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

// order_id is top level; error_type, tracking and refunds live in `data`.
const eventData = z
  .object({
    // Checked where a failure is settled.
    error_type: z.unknown(),
    // Checked package by package by packagesFromZinc, which keeps only whitelisted fields.
    tracking_numbers: z.unknown(),
    // Every event shares this schema, so a field only some events use must never reject one:
    // a strict shape here would drop an order.placed or order.cancelled we can't get back (E4).
    // calendarDay checks the estimate where it's used; refundCents checks the refund below.
    estimated_delivery: z.unknown(),
    refund_amount: z.unknown(),
  })
  .partial();

const event = z.object({
  event: z.string(),
  order_id: z.string().optional(),
  timestamp: z.string().optional(),
  data: eventData.optional(),
});

export type ZincEvent = {
  event: string;
  orderId?: string;
  /** When Zinc says the event happened (ISO 8601, sometimes without a Z; it is UTC). */
  timestamp?: string;
  /** order.failed: Zinc's reason, unchecked. */
  errorType?: unknown;
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
    errorType: e.data?.error_type ?? undefined,
    trackingNumbers: e.data?.tracking_numbers,
    estimatedDelivery: e.data?.estimated_delivery ?? undefined,
    refundCents: refundCents(e.data?.refund_amount),
    raw: json,
  };
}

function refundCents(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}
