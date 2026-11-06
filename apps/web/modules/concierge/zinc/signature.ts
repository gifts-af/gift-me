import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Zinc signs the raw body with HMAC-SHA256 (hex) using the account's webhook secret. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header) return false;
  const got = Buffer.from(header.trim().replace(/^sha256=/, ""), "utf8");
  const want = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

const event = z.object({
  event: z.string(),
  order_id: z.string().optional(),
  error_type: z.string().optional(),
});

export type ZincEvent = { event: string; orderId?: string; errorType?: string; raw: unknown };

/** Throws a ZodError on a body that is not an event. */
export function parseEvent(json: unknown): ZincEvent {
  const e = event.parse(json);
  return { event: e.event, orderId: e.order_id, errorType: e.error_type, raw: json };
}
