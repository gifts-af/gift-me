import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { clearWebhook, getWallet, mintSandboxKey, pollDevice, setWebhook, startDevice } from "../zinc/account";
import { ZincError, type ZincHttp } from "../zinc/client";
import { createOrder, findOrderByReference } from "../zinc/orders";
import { placeWithRetry } from "../zinc/retry";
import { parseEvent, verifySignature } from "../zinc/signature";
import type { ZincOrderInput } from "../zinc/types";

const KEY = "zn_test_SECRETKEY123";
type Reply = { status: number; body?: unknown; raw?: string } | Error;
type Call = { method: string; url: string; auth: string | null; body: unknown };

function fake(replies: Reply[], timeoutMs = 1000) {
  const calls: Call[] = [];
  const queue = [...replies];
  const f = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({
      method: init.method ?? "GET",
      url,
      auth: headers.get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = queue.shift();
    if (!r) throw new Error("no reply queued");
    if (r instanceof Error) throw r;
    const text = r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(r.status === 204 ? null : text, { status: r.status });
  }) as unknown as typeof fetch;
  const h: ZincHttp = { base: "https://zinc.test", timeoutMs, fetch: f };
  return { h, calls };
}

const order: ZincOrderInput = {
  reference: "order-1",
  idempotencyKey: "idem-1",
  productUrl: "https://shop.test/p/1",
  maxPriceCents: 5000,
  shipTo: { firstName: "A", lastName: "B", line1: "1 Main", line2: null, city: "Town", state: "CA", postalCode: "94043", country: "US" },
  phone: "6505550100",
  giftMessage: "Happy birthday",
};
const created = { status: 201, body: { id: "zo_1" } };
const nestedErr = (status: number, code: string, details?: unknown) => ({ status, body: { error: { code, message: "m", details } } });

describe("account", () => {
  it("maps the device code reply", async () => {
    const { h, calls } = fake([
      { status: 200, body: { device_code: "dc", user_code: "ABCD", verification_uri: "https://app.zinc.com/activate", verification_uri_complete: "https://app.zinc.com/activate?c=ABCD", expires_in: 600, interval: 5 } },
    ]);
    const now = new Date("2026-11-06T00:00:00Z");
    const r = await startDevice(h, "Gifts AF", now);
    expect(r).toEqual({ deviceCode: "dc", userCode: "ABCD", verificationUrl: "https://app.zinc.com/activate?c=ABCD", expiresAt: new Date("2026-11-06T00:10:00Z"), intervalSec: 5 });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zinc.test/device/code", auth: null });
  });

  it("maps poll replies", async () => {
    const { h } = fake([
      nestedErr(400, "authorization_pending"),
      nestedErr(400, "slow_down"),
      { status: 200, body: { key: KEY } },
      nestedErr(400, "access_denied"),
      nestedErr(400, "expired_token"),
    ]);
    expect(await pollDevice(h, "dc")).toEqual({ status: "pending" });
    expect(await pollDevice(h, "dc")).toEqual({ status: "slow_down" });
    expect(await pollDevice(h, "dc")).toEqual({ status: "approved", apiKey: KEY });
    expect(await pollDevice(h, "dc")).toEqual({ status: "denied" });
    expect(await pollDevice(h, "dc")).toEqual({ status: "expired" });
  });

  it("maps a 429 on the token poll to slow_down", async () => {
    const { h } = fake([nestedErr(429, "rate_limit_exceeded")]);
    expect(await pollDevice(h, "dc")).toEqual({ status: "slow_down" });
  });

  it("mints a sandbox key with no auth", async () => {
    const { h, calls } = fake([{ status: 201, body: { api_key: KEY, claim_url: "x" } }]);
    expect(await mintSandboxKey(h)).toEqual({ apiKey: KEY });
    expect(calls[0].auth).toBeNull();
  });

  it("reads the wallet; auto top-up is unknown", async () => {
    const { h, calls } = fake([{ status: 200, body: { balance: 900, spendable_balance: 800, order_fee_cents: 100 } }]);
    expect(await getWallet(h, KEY)).toEqual({ balanceCents: 800, autoTopUp: null });
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
  });

  it("sets and clears the webhook", async () => {
    const { h, calls } = fake([{ status: 200, body: { webhook_url: "u", webhook_secret: "zn_whsec_abc" } }, { status: 204 }]);
    expect(await setWebhook(h, KEY, "https://app.test/hook")).toEqual({ secret: "zn_whsec_abc" });
    await clearWebhook(h, KEY);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PUT https://zinc.test/webhooks/endpoint", "DELETE https://zinc.test/webhooks/endpoint"]);
    expect(calls[0].body).toEqual({ url: "https://app.test/hook" });
  });
});

describe("errors", () => {
  it("500 and network failure are unavailable", async () => {
    const { h } = fake([{ status: 500, body: {} }, new TypeError("fetch failed")]);
    await expect(getWallet(h, KEY)).rejects.toMatchObject({ kind: "unavailable", status: 500 });
    await expect(getWallet(h, KEY)).rejects.toMatchObject({ kind: "unavailable", status: 0 });
  });

  it("a timeout is unavailable", async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason)))) as unknown as typeof fetch;
    const h: ZincHttp = { base: "https://zinc.test", timeoutMs: 10, fetch: f };
    await expect(getWallet(h, KEY)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("401 is unauthorized and carries the nested code", async () => {
    const { h } = fake([nestedErr(401, "invalid_api_key")]);
    await expect(getWallet(h, KEY)).rejects.toMatchObject({ kind: "unauthorized", status: 401, code: "invalid_api_key" });
  });

  it("a malformed body is rejected with no body text in the message", async () => {
    const { h } = fake([{ status: 200, raw: "<html>secret-body-text</html>" }, { status: 200, body: { nope: "secret-body-text" } }]);
    for (let i = 0; i < 2; i++) {
      const err = await getWallet(h, KEY).catch((e) => e);
      expect(err).toBeInstanceOf(ZincError);
      expect(err.kind).toBe("rejected");
      expect(err.message).not.toContain("secret-body-text");
    }
  });

  it("never puts the key in an error", async () => {
    const { h } = fake([nestedErr(400, "bad", { echo: KEY }), new Error(`boom ${KEY}`)]);
    for (let i = 0; i < 2; i++) {
      const err = await getWallet(h, KEY).catch((e) => e);
      expect(err).toBeInstanceOf(ZincError);
      expect(JSON.stringify({ m: err.message, s: err.stack, c: err.cause })).not.toContain(KEY);
    }
  });
});

describe("orders", () => {
  it("sends our order shape", async () => {
    const { h, calls } = fake([created]);
    expect(await createOrder(h, KEY, order)).toEqual({ providerOrderId: "zo_1" });
    expect(calls[0].body).toMatchObject({
      products: [{ url: order.productUrl, quantity: 1 }],
      max_price: 5000,
      is_gift: true,
      fulfillment: { gift: "best_effort" },
      gift_message: "Happy birthday",
      idempotency_key: "idem-1",
      metadata: { order_id: "order-1" },
      shipping_address: { first_name: "A", last_name: "B", address_line1: "1 Main", postal_code: "94043", country: "US", phone_number: "6505550100" },
    });
  });

  it("rejects an idempotency key over 36 characters without sending", async () => {
    const { h, calls } = fake([]);
    await expect(createOrder(h, KEY, { ...order, idempotencyKey: "x".repeat(37) })).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toHaveLength(0);
  });

  it("402 becomes insufficient", async () => {
    const { h } = fake([nestedErr(402, "insufficient_funds", { required: 5100, available: 300, short_by: 4800 })]);
    expect(await createOrder(h, KEY, order)).toEqual({ insufficient: { requiredCents: 5100, availableCents: 300 } });
  });

  it("409 already_exists becomes exists", async () => {
    const { h } = fake([nestedErr(409, "already_exists", { identifier: "idem-1" })]);
    expect(await createOrder(h, KEY, order)).toEqual({ exists: true });
  });

  it("other 4xx is rejected", async () => {
    const { h } = fake([nestedErr(422, "invalid_address")]);
    await expect(createOrder(h, KEY, order)).rejects.toMatchObject({ kind: "rejected", code: "invalid_address" });
  });

  it("finds an order by reference and maps its state", async () => {
    const list = (o: unknown[]) => ({ status: 200, body: { orders: o, total: o.length, limit: 10, offset: 0 } });
    const { h, calls } = fake([
      list([{ id: "zo_1", status: "pending", job_result: null }]),
      list([{ id: "zo_1", status: "order_placed", job_result: { success: true } }]),
      list([{ id: "zo_1", status: "order_failed", job_result: { success: false, error_type: "out_of_stock" } }]),
      list([]),
    ]);
    expect(await findOrderByReference(h, KEY, "order-1")).toEqual({ providerOrderId: "zo_1", status: "pending" });
    expect(await findOrderByReference(h, KEY, "order-1")).toEqual({ providerOrderId: "zo_1", status: "placed" });
    expect(await findOrderByReference(h, KEY, "order-1")).toEqual({ providerOrderId: "zo_1", status: "failed", errorType: "out_of_stock" });
    expect(await findOrderByReference(h, KEY, "order-1")).toBeNull();
    expect(calls[0].url).toBe("https://zinc.test/orders?metadata_key=order_id&metadata_value=order-1");
  });

  it("carries a placed order's price components, and drops a malformed block", async () => {
    const list = (o: unknown[]) => ({ status: 200, body: { orders: o, total: o.length, limit: 10, offset: 0 } });
    const pc = { subtotal: 3955, tax: 346, shipping: 599, total: 4900, discount: 0, fees: 0, currency: "USD" };
    const { h } = fake([
      list([{ id: "zo_1", status: "order_placed", job_result: { success: true, price_components: pc } }]),
      list([{ id: "zo_1", status: "order_placed", job_result: { success: true, price_components: { total: "49.00" } } }]),
    ]);
    expect(await findOrderByReference(h, KEY, "order-1")).toEqual({
      providerOrderId: "zo_1",
      status: "placed",
      price: { subtotalCents: 3955, shippingCents: 599, taxCents: 346, totalCents: 4900 },
    });
    expect(await findOrderByReference(h, KEY, "order-1")).toEqual({ providerOrderId: "zo_1", status: "placed" });
  });

  it("a lookup's unreadable 2xx is unavailable (we can't tell), not rejected", async () => {
    const { h } = fake([{ status: 200, body: { orders: "nope" } }, { status: 200, raw: "<html>" }]);
    await expect(findOrderByReference(h, KEY, "order-1")).rejects.toMatchObject({ kind: "unavailable" });
    await expect(findOrderByReference(h, KEY, "order-1")).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("placeWithRetry", () => {
  const r = () => ({ attempts: 3, baseMs: 1000, sleep: vi.fn(async (...args: [number]) => void args), random: () => 0.5 });
  const empty = { status: 200, body: { orders: [], total: 0, limit: 10, offset: 0 } };
  const timeout = new Error("timeout");

  it("retries timeouts with the same key and backoff", async () => {
    const { h, calls } = fake([timeout, empty, timeout, empty, created]);
    const opts = r();
    expect(await placeWithRetry(h, KEY, order, opts)).toMatchObject({ providerOrderId: "zo_1" });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => (p.body as { idempotency_key: string }).idempotency_key))).toEqual(new Set(["idem-1"]));
    expect(opts.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("returns the order when the lookup finds it", async () => {
    const { h, calls } = fake([timeout, { status: 200, body: { orders: [{ id: "zo_9", status: "pending", job_result: null }] } }]);
    expect(await placeWithRetry(h, KEY, order, r())).toMatchObject({ providerOrderId: "zo_9" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("looks up after a 409", async () => {
    const { h } = fake([nestedErr(409, "already_exists"), { status: 200, body: { orders: [{ id: "zo_9", status: "pending", job_result: null }] } }]);
    expect(await placeWithRetry(h, KEY, order, r())).toMatchObject({ providerOrderId: "zo_9" });
  });

  it("does not retry a 402", async () => {
    const { h, calls } = fake([nestedErr(402, "insufficient_funds", { required: 1, available: 0 })]);
    expect(await placeWithRetry(h, KEY, order, r())).toEqual({ insufficient: { requiredCents: 1, availableCents: 0 } });
    expect(calls).toHaveLength(1);
  });

  it("does not retry other 4xx", async () => {
    const { h, calls } = fake([nestedErr(422, "invalid_address")]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toHaveLength(1);
  });

  it("a 201 with an unreadable body is looked up, not resent", async () => {
    const { h, calls } = fake([{ status: 201, raw: '{"id": "zo_' }, { status: 200, body: { orders: [{ id: "zo_5", status: "pending", job_result: null }] } }]);
    expect(await placeWithRetry(h, KEY, order, r())).toMatchObject({ providerOrderId: "zo_5" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  // B1: once an attempt may have created the order, no later error may read as "nothing created".
  it("after a timeout, a lookup's garbage 2xx is unavailable, never rejected", async () => {
    const { h, calls } = fake([timeout, { status: 200, body: { nope: true } }, nestedErr(422, "invalid_address")]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
    // Resends reuse the same idempotency key, so they can never make a second order.
    expect(new Set(calls.filter((c) => c.method === "POST").map((c) => (c.body as { idempotency_key: string }).idempotency_key))).toEqual(new Set(["idem-1"]));
  });

  it("after a timeout, a lookup's 4xx is unavailable, never rejected", async () => {
    const { h } = fake([timeout, nestedErr(400, "bad_request")]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("after a timeout, a resend's 4xx or 401 is unavailable", async () => {
    const a = fake([timeout, empty, nestedErr(422, "invalid_address")]);
    await expect(placeWithRetry(a.h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
    const b = fake([timeout, empty, nestedErr(401, "unauthorized")]);
    await expect(placeWithRetry(b.h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("after a timeout, a resend's 402 is unavailable (the first try may exist)", async () => {
    const { h } = fake([timeout, empty, nestedErr(402, "insufficient_funds", { required: 1, available: 0 })]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("after a 409, a lookup's 4xx is unavailable", async () => {
    const { h } = fake([nestedErr(409, "already_exists"), nestedErr(400, "bad_request")]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("gives up as unavailable after the last attempt", async () => {
    const { h, calls } = fake([timeout, empty, timeout, empty, timeout]);
    await expect(placeWithRetry(h, KEY, order, r())).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });
});

describe("signature", () => {
  const secret = "zn_whsec_test";
  const body = '{"event":"order.placed","order_id":"zo_1"}';
  const sig = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts the right signature and rejects a one-byte change", () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body.replace("zo_1", "zo_2"), sig, secret)).toBe(false);
    expect(verifySignature(body, sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"), secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("reads error_type from data on order.failed", () => {
    const e = parseEvent({ event: "order.failed", order_id: "zo_1", data: { error_type: "product_not_found", error: "x" } });
    expect(e).toMatchObject({ event: "order.failed", orderId: "zo_1", errorType: "product_not_found", error: "x" });
  });

  it("reads wallet event fields from data", () => {
    const e = parseEvent({ event: "wallet.auto_topup.succeeded", data: { amount_cents: 10000, status: "succeeded" } });
    expect(e).toMatchObject({ event: "wallet.auto_topup.succeeded", amountCents: 10000, status: "succeeded" });
    expect(e.orderId).toBeUndefined();
  });

  it("parses events and rejects junk", () => {
    expect(parseEvent({ event: "order.placed", order_id: "zo_1" })).toMatchObject({ event: "order.placed", orderId: "zo_1" });
    expect(() => parseEvent({ nope: 1 })).toThrow();
  });
});
