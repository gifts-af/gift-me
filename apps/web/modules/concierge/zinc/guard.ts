// What the Zinc webhook route checks before it trusts a request (ALL-32): the id is
// UUID-shaped (no database call for junk) and the body fits zinc_webhook_max_bytes.
import { z } from "zod";

const uuid = z.string().uuid();

export type WebhookBody = { ok: true; body: string } | { ok: false; status: 404 | 413 };

/** Reads the raw body, or says why not: 404 for a malformed id, 413 for a body over the cap. */
export async function readWebhookBody(
  webhookId: string,
  request: Request,
  maxBytes: () => Promise<number>,
): Promise<WebhookBody> {
  if (!uuid.safeParse(webhookId).success) return { ok: false, status: 404 };
  const cap = await maxBytes();
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return { ok: false, status: 413 };

  // content-length can be absent or wrong, so the cap is enforced while reading too.
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: "" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  return { ok: true, body: Buffer.concat(chunks).toString("utf8") };
}
