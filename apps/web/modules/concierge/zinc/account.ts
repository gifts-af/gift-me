import { z } from "zod";
import { call, parseBody, send, type ZincHttp } from "./client";

const deviceCode = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().optional(),
});

/** `now` is passed in (E3) so expiresAt is testable. */
export async function startDevice(h: ZincHttp, name: string, now: Date) {
  const r = await call(h, "POST", "/device/code", deviceCode, { key: null, body: { name } });
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUrl: r.verification_uri_complete ?? r.verification_uri,
    expiresAt: new Date(now.getTime() + r.expires_in * 1000),
    intervalSec: r.interval ?? 5,
  };
}

export type PollResult =
  | { status: "pending" | "slow_down" | "denied" | "expired" }
  | { status: "approved"; apiKey: string };

const tokenOk = z.object({ key: z.string().optional(), api_key: z.string().optional() });

export async function pollDevice(h: ZincHttp, deviceCode: string): Promise<PollResult> {
  const path = "/device/token";
  const r = await send(h, "POST", path, { key: null, body: { device_code: deviceCode }, tolerate: "4xx" });
  if (r.status < 300) {
    const t = parseBody(tokenOk, r.json, "POST", path, r.status);
    const apiKey = t.key ?? t.api_key;
    if (!apiKey) parseBody(z.never(), r.json, "POST", path, r.status);
    return { status: "approved", apiKey: apiKey as string };
  }
  if (r.status === 429) return { status: "slow_down" };
  switch (r.code) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
    case "expired":
      return { status: "expired" };
    default:
      parseBody(z.never(), r.json, "POST", path, r.status);
      throw new Error("unreachable");
  }
}

export async function mintSandboxKey(h: ZincHttp): Promise<{ apiKey: string }> {
  const r = await call(h, "POST", "/sandbox/keys", z.object({ api_key: z.string() }), {
    key: null,
    body: { name: "gift-concierge" },
  });
  return { apiKey: r.api_key };
}

// /wallet/me has no auto top-up field (ALL-32 facts check), so autoTopUp is always null
// here; the wallet.auto_topup.* webhooks supply it elsewhere.
export async function getWallet(
  h: ZincHttp,
  key: string,
): Promise<{ balanceCents: number; autoTopUp: boolean | null }> {
  const r = await call(h, "GET", "/wallet/me", z.object({ spendable_balance: z.number() }), { key });
  return { balanceCents: r.spendable_balance, autoTopUp: null };
}

export async function setWebhook(h: ZincHttp, key: string, url: string): Promise<{ secret: string }> {
  const r = await call(h, "PUT", "/webhooks/endpoint", z.object({ webhook_secret: z.string() }), {
    key,
    body: { url },
  });
  return { secret: r.webhook_secret };
}

export async function clearWebhook(h: ZincHttp, key: string): Promise<void> {
  await send(h, "DELETE", "/webhooks/endpoint", { key });
}
