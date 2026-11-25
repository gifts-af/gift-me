import { createHmac, timingSafeEqual } from "node:crypto";

// Queue messages are signed by the tick, or by the job that sends a follow-up, and checked by the
// job that gets them. @vercel/queue's handleCallback verifies nothing itself, so this is the app's
// own guard on the job route: only something that knows CRON_SECRET can make a message the job
// will run. The secret is an argument (E3).

/** JSON with object keys sorted at every level, so the same message always signs the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const mac = (message: object, secret: string) => createHmac("sha256", secret).update(canonical(message)).digest("hex");

/** The message with its `sig` (HMAC-SHA256, hex, of the message without it). */
export function signMessage<T extends object>(message: T, secret: string): T & { sig: string } {
  return { ...message, sig: mac(message, secret) };
}

/** True only for a `sig` made with this secret over exactly the rest of the message. */
export function verifyMessage(message: { sig?: string } & object, secret: string | undefined): boolean {
  if (!secret || typeof message.sig !== "string") return false;
  const { sig, ...rest } = message;
  const want = Buffer.from(mac(rest, secret), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
