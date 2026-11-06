// The only place that talks to Zinc's HTTP API (E4). Everything else uses the typed
// functions in account.ts and orders.ts. Settings arrive through `ZincHttp` (E3).
// Errors never carry the API key or any response body text (E6).
import type { ZodType } from "zod";
import { z } from "zod";

export type ZincHttp = { base: string; timeoutMs: number; fetch: typeof fetch };

export type ZincErrorKind = "unavailable" | "unauthorized" | "rejected";

export class ZincError extends Error {
  kind: ZincErrorKind;
  status: number;
  code?: string;
  constructor(kind: ZincErrorKind, status: number, message: string, code?: string) {
    super(message);
    this.name = "ZincError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// Zinc nests errors: { error: { code, message, details } }.
const errorBody = z.object({
  error: z.object({ code: z.string().optional(), details: z.unknown().optional() }),
});

export type ZincReply = { status: number; json: unknown; code?: string; details?: unknown };

type SendOptions = {
  key: string | null;
  body?: unknown;
  query?: Record<string, string>;
  /** Statuses (or "4xx") handed back to the caller instead of thrown. */
  tolerate?: number[] | "4xx";
};

function fail(kind: ZincErrorKind, status: number, method: string, path: string, code?: string): ZincError {
  // Path only (no query, no body, no key): safe to log.
  return new ZincError(kind, status, `Zinc ${method} ${path} failed (${status}${code ? ` ${code}` : ""})`, code);
}

/** One HTTP call. Throws ZincError unless the status is 2xx or tolerated. */
export async function send(h: ZincHttp, method: string, path: string, o: SendOptions): Promise<ZincReply> {
  const query = o.query ? `?${new URLSearchParams(o.query).toString()}` : "";
  let res: Response;
  try {
    res = await h.fetch(`${h.base}${path}${query}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(h.timeoutMs),
    });
  } catch {
    // Network error or timeout. Drop the original error: it may echo the request.
    throw fail("unavailable", 0, method, path);
  }

  const text = await res.text().catch(() => "");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (res.status >= 200 && res.status < 300) return { status: res.status, json };

  const parsed = errorBody.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : undefined;
  const details = parsed.success ? parsed.data.error.details : undefined;
  const tolerated =
    o.tolerate === "4xx" ? res.status >= 400 && res.status < 500 : (o.tolerate ?? []).includes(res.status);
  if (tolerated) return { status: res.status, json, code, details };

  if (res.status >= 500 || res.status === 429) throw fail("unavailable", res.status, method, path, code);
  if (res.status === 401 || res.status === 403) throw fail("unauthorized", res.status, method, path, code);
  throw fail("rejected", res.status, method, path, code);
}

/** Validates a body at the boundary. A mismatch is `rejected`, with no body text. */
export function parseBody<T>(schema: ZodType<T>, json: unknown, method: string, path: string, status: number): T {
  const r = schema.safeParse(json);
  if (!r.success) throw fail("rejected", status, method, path, "malformed_response");
  return r.data;
}

/** send + validate in one step, for the plain success path. */
export async function call<T>(
  h: ZincHttp,
  method: string,
  path: string,
  schema: ZodType<T>,
  o: SendOptions,
): Promise<T> {
  const r = await send(h, method, path, o);
  return parseBody(schema, r.json, method, path, r.status);
}
