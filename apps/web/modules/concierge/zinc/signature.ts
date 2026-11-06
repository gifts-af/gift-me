import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Zinc signs the raw body with HMAC-SHA256 (hex) using the account's webhook secret. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const got = Buffer.from(header.trim().replace(/^sha256=/, ""), "utf8");
  const want = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

// order_id is top level; error_type and the wallet fields live in `data`.
const eventData = z
  .object({
    error_type: z.string(),
    error: z.string(),
    amount_cents: z.number(),
    status: z.string(),
  })
  .partial();

const event = z.object({
  event: z.string(),
  order_id: z.string().optional(),
  data: eventData.optional(),
});

export type ZincEvent = {
  event: string;
  orderId?: string;
  /** order.failed */
  errorType?: string;
  /** order.failed, wallet.auto_topup.failed */
  error?: string;
  /** wallet.auto_topup.* */
  amountCents?: number;
  status?: string;
  raw: unknown;
};

/** Throws a ZodError on a body that is not an event. */
export function parseEvent(json: unknown): ZincEvent {
  const e = event.parse(json);
  return {
    event: e.event,
    orderId: e.order_id,
    errorType: e.data?.error_type,
    error: e.data?.error,
    amountCents: e.data?.amount_cents,
    status: e.data?.status,
    raw: json,
  };
}
