// Card orders at Zinc's HTTP edge: the app key is usable only through sendConnectOrder, which
// refuses any body without the payment; the decline codes; and Zinc's charge read back. Zinc is
// faked (we don't own it).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CODES, CARD_CODES, failureTypeFor, isAccountCode, isCardCode } from "../zinc/card-codes";
import type { ZincHttp } from "../zinc/client";
import { alertIfOver, connectKey, createOrder, findOrderByReference, placedPrice, sendConnectOrder } from "../zinc/orders";
import { placeWithRetry } from "../zinc/retry";
import type { ZincOrderInput, ZincPayment } from "../zinc/types";

const APP_KEY = "zn_test_APPKEY123";
type Reply = { status: number; body?: unknown } | Error;
type Call = { method: string; url: string; auth: string | null; body: unknown };

function fake(replies: Reply[]) {
  const calls: Call[] = [];
  const queue = [...replies];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      auth: new Headers(init.headers).get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = queue.shift();
    if (!r) throw new Error("no reply queued");
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const h: ZincHttp = { base: "https://zinc.test", timeoutMs: 1000, fetch: f };
  return { h, calls };
}

const payment: ZincPayment = { mode: "connect", paymentMethod: "pm_saved", customer: "cus_1", marginCents: 100 };
const order: ZincOrderInput = {
  reference: "order-1",
  idempotencyKey: "idem-1",
  productUrl: "https://shop.test/p/1",
  maxPriceCents: 2259,
  shipTo: { firstName: "A", lastName: "B", line1: "1 Main", line2: null, city: "Town", state: "CA", postalCode: "94043", country: "US" },
  phone: "6505550100",
  giftMessage: null,
  payment,
};
const err = (status: number, code: string) => ({ status, body: { error: { code, message: "m" } } });
const retry = { attempts: 3, baseMs: 1, sleep: async () => {}, random: () => 0 };

afterEach(() => vi.restoreAllMocks());

describe("card codes", () => {
  it("lists Zinc's documented card codes only (A1)", () => {
    expect([...CARD_CODES].sort()).toEqual(["insufficient_funds", "invalid_payment_method", "payment_failed"].sort());
    expect(isCardCode("payment_failed")).toBe(true);
    expect(isCardCode("payment_declined")).toBe(false);
    expect(isCardCode(undefined)).toBe(false);
  });

  it("codes about our own Zinc account or our own bug are not the buyer's card, and never card_declined", () => {
    expect([...ACCOUNT_CODES].sort()).toEqual(
      ["app_key_missing", "card_verification_required", "payment_method_required", "payment_missing", "stripe_error"].sort(),
    );
    for (const code of ACCOUNT_CODES) {
      expect(isAccountCode(code)).toBe(true);
      expect(isCardCode(code)).toBe(false);
      expect(failureTypeFor(code, "connect")).toBe("failed");
    }
    expect(isAccountCode("payment_failed")).toBe(false);
    expect(isAccountCode(undefined)).toBe(false);
  });

  it("a card code on a card order is card_declined; the store refusing payment stays failed; never funds (AC-6)", () => {
    for (const code of CARD_CODES) expect(failureTypeFor(code, "connect")).toBe("card_declined");
    expect(failureTypeFor("payment_declined", "connect")).toBe("failed");
    expect(failureTypeFor("something_new", "connect")).toBe("failed");
    expect(failureTypeFor(undefined, "connect")).toBe("failed");
    for (const code of [...CARD_CODES, "payment_declined", undefined]) expect(failureTypeFor(code, "zinc_wallet")).toBe("failed");
  });

  it("maps Zinc's other error types the same for both ways of paying", () => {
    for (const mode of ["connect", "zinc_wallet"]) {
      expect(failureTypeFor("max_price_exceeded", mode)).toBe("price_up");
      expect(failureTypeFor("out_of_stock", mode)).toBe("out_of_stock");
      expect(failureTypeFor("invalid_shipping_address", mode)).toBe("invalid_shipping_address");
    }
  });
});

describe("sendConnectOrder (the only way to create an order with the app key)", () => {
  it("sends the exact payment object, the order's card and the saved margin, on the app key (AC-3)", async () => {
    const { h, calls } = fake([{ status: 201, body: { id: "zo_1" } }]);
    expect(await sendConnectOrder(h, connectKey(APP_KEY), order)).toEqual({ providerOrderId: "zo_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe(`Bearer ${APP_KEY}`);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.payment).toEqual({ mode: "connect", payment_method: "pm_saved", customer: "cus_1", margin: { type: "flat", value: 100 } });
    // max_price stays the goods cap: no margin or fees in it.
    expect(body.max_price).toBe(2259);
  });

  it.each([
    ["no payment", { ...order, payment: null }],
    ["no card", { ...order, payment: { ...payment, paymentMethod: "" } }],
    ["no customer", { ...order, payment: { ...payment, customer: "" } }],
    ["a negative margin", { ...order, payment: { ...payment, marginCents: -1 } }],
    ["a fractional margin", { ...order, payment: { ...payment, marginCents: 1.5 } }],
    ["another mode", { ...order, payment: { ...payment, mode: "wallet" } as unknown as ZincPayment }],
  ])("throws before any request with %s", async (_, o) => {
    const { h, calls } = fake([]);
    await expect(sendConnectOrder(h, connectKey(APP_KEY), o)).rejects.toMatchObject({ kind: "rejected", code: "payment_missing" });
    expect(calls).toEqual([]);
  });

  it("a key that wasn't made by connectKey sends nothing", async () => {
    const { h, calls } = fake([]);
    const forged = JSON.parse(JSON.stringify(connectKey(APP_KEY)));
    await expect(sendConnectOrder(h, forged, order)).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toEqual([]);
  });

  it("the key never shows when the handle is logged or serialized", () => {
    expect(JSON.stringify({ k: connectKey(APP_KEY) })).not.toContain(APP_KEY);
    expect(String(connectKey(APP_KEY))).not.toContain(APP_KEY);
  });

  it("a 402 is a rejection carrying its code, never a wallet shortfall", async () => {
    const { h } = fake([err(402, "payment_failed"), { status: 402, body: {} }]);
    await expect(sendConnectOrder(h, connectKey(APP_KEY), order)).rejects.toMatchObject({ kind: "rejected", status: 402, code: "payment_failed" });
    await expect(sendConnectOrder(h, connectKey(APP_KEY), order)).rejects.toMatchObject({ kind: "rejected", status: 402, code: undefined });
  });

  it("a 401 is unauthorized", async () => {
    const { h } = fake([err(401, "invalid_api_key")]);
    await expect(sendConnectOrder(h, connectKey(APP_KEY), order)).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("a wallet order never carries a payment, and its body has no payment key", async () => {
    const { h, calls } = fake([{ status: 201, body: { id: "zo_1" } }]);
    await expect(createOrder(h, "zn_test_buyer", order)).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toEqual([]);
    await createOrder(h, "zn_test_buyer", { ...order, payment: null });
    expect(calls[0].body).not.toHaveProperty("payment");
  });
});

describe("placeWithRetry with the app key", () => {
  it("every create sent with the app key carries the payment, resends included, and looks up on the app key", async () => {
    const { h, calls } = fake([new TypeError("down"), { status: 200, body: { orders: [] } }, { status: 201, body: { id: "zo_2" } }]);
    expect(await placeWithRetry(h, connectKey(APP_KEY), order, retry)).toEqual({ providerOrderId: "zo_2" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /orders", "GET /orders", "POST /orders"]);
    expect(calls.every((c) => c.auth === `Bearer ${APP_KEY}`)).toBe(true);
    for (const c of calls.filter((x) => x.method === "POST")) expect((c.body as { payment: unknown }).payment).toMatchObject({ mode: "connect", payment_method: "pm_saved" });
  });

  it("a decline on the first try is rejected with its code; after a timeout it stays unavailable (T56)", async () => {
    const first = fake([err(402, "payment_failed")]);
    await expect(placeWithRetry(first.h, connectKey(APP_KEY), order, retry)).rejects.toMatchObject({ kind: "rejected", code: "payment_failed" });
    const later = fake([new TypeError("down"), { status: 200, body: { orders: [] } }, err(402, "payment_failed")]);
    await expect(placeWithRetry(later.h, connectKey(APP_KEY), order, retry)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("a card order without its payment is refused before any request, even through the retry", async () => {
    const { h, calls } = fake([]);
    await expect(placeWithRetry(h, connectKey(APP_KEY), { ...order, payment: null }, retry)).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toEqual([]);
  });
});

describe("Zinc's charge on a placed card order", () => {
  it("reads the prices and connect.final_charge, and maps them to settle_order's price (A7)", async () => {
    const { h } = fake([
      {
        status: 200,
        body: {
          orders: [
            {
              id: "zo_1",
              status: "order_placed",
              job_result: { success: true, price_components: { subtotal: 2000, shipping: 0, tax: 159, total: 2159 } },
              connect: { state: "captured", final_charge: 2461 },
            },
          ],
        },
      },
    ]);
    const found = await findOrderByReference(h, connectKey(APP_KEY), "order-1");
    expect(placedPrice(found!)).toEqual({
      provider_order_id: "zo_1",
      subtotal_cents: 2000,
      shipping_cents: 0,
      tax_cents: 159,
      total_cents: 2159,
      final_charge_cents: 2461,
    });
  });

  it("leaves out a charge Zinc doesn't give in whole cents", async () => {
    const { h } = fake([{ status: 200, body: { orders: [{ id: "zo_1", status: "order_placed", connect: { final_charge: 24.61 } }] } }]);
    expect(placedPrice((await findOrderByReference(h, connectKey(APP_KEY), "order-1"))!)).toEqual({ provider_order_id: "zo_1" });
  });

  it("alerts only when Zinc charged more than the approved maximum (AC-4)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const o = { id: "o1", round_id: "r1", user_id: "u1", max_charge_cents: 2564 };
    alertIfOver(o, { provider_order_id: "zo_1", final_charge_cents: 2564 });
    alertIfOver(o, { provider_order_id: "zo_1" });
    alertIfOver({ ...o, max_charge_cents: null }, { provider_order_id: "zo_1", final_charge_cents: 9999 });
    expect(log).not.toHaveBeenCalled();
    alertIfOver(o, { provider_order_id: "zo_1", final_charge_cents: 2565 });
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(events).toEqual([
      expect.objectContaining({ event: "order.over_max_charge", order_id: "o1", round_id: "r1", user_id: "u1", charge_cents: 2565, max_charge_cents: 2564, alert: true }),
    ]);
  });
});
