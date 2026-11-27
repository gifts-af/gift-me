// The only place that talks to Stripe's HTTP API (E4), by fetch with form-encoded bodies,
// the way zinc/client.ts talks to Zinc (no Stripe package, T10). Settings arrive through
// `StripeHttp` (E3). Errors carry Stripe's error code only: never the key, the path (it
// holds customer and card ids) or Stripe's message, which repeats ids (E6).
import type { ZodType } from "zod";
import { z } from "zod";

const BASE = "https://api.stripe.com";

/** `base`: Stripe's API, unless the browser tests point it at their stand-in (STRIPE_API_BASE). */
export type StripeHttp = { key: string; mode: "test" | "live"; timeoutMs: number; fetch: typeof fetch; base?: string };

export type StripeErrorKind = "unavailable" | "unauthorized" | "rejected";

export class StripeError extends Error {
  kind: StripeErrorKind;
  status: number;
  code?: string;
  constructor(kind: StripeErrorKind, status: number, op: string, code?: string) {
    super(`Stripe ${op} failed (${status}${code ? ` ${code}` : ""})`);
    this.name = "StripeError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// Stripe's errors: { error: { type, code?, message } }. Only the code is kept.
const errorBody = z.object({ error: z.object({ code: z.string().optional() }) });
const TOKEN = /^[a-z0-9_]{1,64}$/;

type FormValue = string | number | boolean | undefined | FormValue[] | { [k: string]: FormValue };

/** Stripe's form encoding: nested keys as a[b][c], arrays as a[0]. Undefined values are left out. */
export function formBody(params: Record<string, FormValue>): URLSearchParams {
  const out = new URLSearchParams();
  const add = (key: string, v: FormValue) => {
    if (v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) add(`${key}[${k}]`, x);
    else out.append(key, String(v));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out;
}

type CallOptions = {
  /** A short name for the call, used in errors instead of the path. */
  op: string;
  body?: Record<string, FormValue>;
  query?: Record<string, string>;
  idempotencyKey?: string;
};

/** One call, validated against `schema`. Throws StripeError unless the status is 2xx and the body fits. */
export async function stripeCall<T>(h: StripeHttp, method: "GET" | "POST", path: string, schema: ZodType<T>, o: CallOptions): Promise<T> {
  const query = o.query ? `?${new URLSearchParams(o.query).toString()}` : "";
  let res: Response;
  try {
    res = await h.fetch(`${h.base ?? BASE}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${h.key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(o.idempotencyKey ? { "Idempotency-Key": o.idempotencyKey } : {}),
      },
      body: o.body ? formBody(o.body).toString() : undefined,
      signal: AbortSignal.timeout(h.timeoutMs),
    });
  } catch {
    // Network error or timeout. Drop the original error: it may echo the request.
    throw new StripeError("unavailable", 0, o.op);
  }

  let json: unknown;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (res.status >= 200 && res.status < 300) {
    const r = schema.safeParse(json);
    if (!r.success) throw new StripeError("rejected", res.status, o.op, "malformed_response");
    return r.data;
  }

  const parsed = errorBody.safeParse(json);
  const raw = parsed.success ? parsed.data.error.code : undefined;
  const code = raw && TOKEN.test(raw) ? raw : undefined;
  if (res.status >= 500 || res.status === 429) throw new StripeError("unavailable", res.status, o.op, code);
  if (res.status === 401 || res.status === 403) throw new StripeError("unauthorized", res.status, o.op, code);
  throw new StripeError("rejected", res.status, o.op, code);
}
