import { ZincError, type ZincHttp } from "./client";
import { createOrder, findOrderByReference } from "./orders";
import type { FoundOrder, ZincOrderInput } from "./types";

export type RetrySettings = {
  /** Total tries, including the first. */
  attempts: number;
  baseMs: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export type PlaceResult =
  | { providerOrderId: string; existing?: FoundOrder }
  | { insufficient: { requiredCents: number; availableCents: number } };

const unavailable = () => new ZincError("unavailable", 0, "Zinc order not confirmed (unavailable)");

/**
 * Places an order, retrying only `unavailable` failures (network, timeout, 5xx, 429, an
 * unreadable 2xx) with the SAME idempotency key. Before each resend it looks the order up by
 * our reference, so a lost response never becomes a second order. 402 and other 4xx on the
 * first POST are never retried.
 *
 * Once any attempt was ambiguous (it may have created the order: an `unavailable` failure or
 * a 409), every later error is thrown as `unavailable`, so the caller keeps the order placing
 * for the sweep. A lookup's 4xx or a resend's 4xx/401 then never reads as "nothing created".
 */
export async function placeWithRetry(
  h: ZincHttp,
  key: string,
  o: ZincOrderInput,
  r: RetrySettings,
): Promise<PlaceResult> {
  let ambiguous = false;
  const after = (e: unknown): ZincError => {
    if (e instanceof ZincError && (e.kind === "unavailable" || !ambiguous)) return e;
    if (!ambiguous) throw e; // not a Zinc error: a bug, not an outcome
    return new ZincError("unavailable", e instanceof ZincError ? e.status : 0, "Zinc order not confirmed (unavailable)", e instanceof ZincError ? e.code : undefined);
  };
  for (let attempt = 1; ; attempt++) {
    let failure: ZincError;
    try {
      const res = await createOrder(h, key, o);
      if ("providerOrderId" in res) return res;
      if ("insufficient" in res) {
        // record_outcomes gives an insufficient order a NEW idempotency key, so after an
        // ambiguous try a 402 must not end the order: the first try may exist at Zinc.
        if (!ambiguous) return res;
        throw unavailable();
      }
      // 409: it exists. Fetch it by reference; if the lookup lags, treat as unavailable.
      ambiguous = true;
      const found = await findOrderByReference(h, key, o.reference);
      if (found) return { providerOrderId: found.providerOrderId, existing: found };
      failure = unavailable();
    } catch (e) {
      failure = after(e);
      if (failure.kind !== "unavailable") throw failure;
      ambiguous = true;
    }
    if (attempt >= r.attempts) throw failure;

    await r.sleep(r.baseMs * 2 ** (attempt - 1) * (0.5 + r.random()));
    try {
      const found = await findOrderByReference(h, key, o.reference);
      if (found) return { providerOrderId: found.providerOrderId, existing: found };
    } catch (e) {
      // Lookup failed: throw as unavailable unless it is one already (ambiguous is true here),
      // and an unavailable one resends with the same key. A 409 on the resend is handled above.
      const f = after(e);
      if (f.kind !== "unavailable") throw f;
    }
  }
}
