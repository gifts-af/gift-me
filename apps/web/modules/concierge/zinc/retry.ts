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
 * Places an order, retrying only `unavailable` failures (network, timeout, 5xx) with the
 * SAME idempotency key. Before each resend it looks the order up by our reference, so a
 * lost response never becomes a second order. 402 and other 4xx are never retried.
 */
export async function placeWithRetry(
  h: ZincHttp,
  key: string,
  o: ZincOrderInput,
  r: RetrySettings,
): Promise<PlaceResult> {
  for (let attempt = 1; ; attempt++) {
    let failure: ZincError;
    try {
      const res = await createOrder(h, key, o);
      if ("providerOrderId" in res || "insufficient" in res) return res;
      // 409: it exists. Fetch it by reference; if the lookup lags, treat as unavailable.
      const found = await findOrderByReference(h, key, o.reference);
      if (found) return { providerOrderId: found.providerOrderId, existing: found };
      failure = unavailable();
    } catch (e) {
      if (!(e instanceof ZincError) || e.kind !== "unavailable") throw e;
      failure = e;
    }
    if (attempt >= r.attempts) throw failure;

    await r.sleep(r.baseMs * 2 ** (attempt - 1) * (0.5 + r.random()));
    try {
      const found = await findOrderByReference(h, key, o.reference);
      if (found) return { providerOrderId: found.providerOrderId, existing: found };
    } catch (e) {
      // Lookup failed: resend with the same key. A 409 on the resend is handled above.
      if (!(e instanceof ZincError) || e.kind !== "unavailable") throw e;
    }
  }
}
