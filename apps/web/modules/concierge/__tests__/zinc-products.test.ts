import { describe, expect, it } from "vitest";
import { ZincError, type ZincHttp } from "../zinc/client";
import { productOffers, searchProducts } from "../zinc/products";

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
    return new Response(text, { status: r.status });
  }) as unknown as typeof fetch;
  const h: ZincHttp = { base: "https://zinc.test", timeoutMs, fetch: f };
  return { h, calls };
}

const signal = () => new AbortController().signal;

const offer = (over: Record<string, unknown> = {}) => ({
  offer_id: "off_1",
  price: 2499,
  available: true,
  condition: "New",
  buy_box_winner: true,
  seller: { name: "Acme", first_party: false },
  handling_days: { min: 0, max: 1 },
  shipping_options: [
    { price: 599, delivery_days: { min: 5, max: 8 } },
    { price: 1299, delivery_days: { min: 2, max: 3 } },
  ],
  optimistic: { prime: true },
  ...over,
});
const offersReply = (offers: unknown[]) => ({ status: 200, body: { status: "completed", asin: "B0TEST", retailer: "amazon", offers } });

describe("searchProducts", () => {
  it("search maps hits", async () => {
    const { h } = fake([
      { status: 200, body: { results: [{ product_id: "B01", title: "Tea Kettle", price: 3500 }, { product_id: "B02", title: "Mug" }] } },
    ]);
    expect(await searchProducts(h, KEY, "tea kettle", signal())).toEqual([
      { productId: "B01", title: "Tea Kettle", priceCents: 3500 },
      { productId: "B02", title: "Mug", priceCents: null },
    ]);
  });

  it("also reads the list under products", async () => {
    const { h } = fake([{ status: 200, body: { products: [{ product_id: "B01", title: "Tea Kettle", price: 3500 }] } }]);
    expect(await searchProducts(h, KEY, "x", signal())).toEqual([{ productId: "B01", title: "Tea Kettle", priceCents: 3500 }]);
  });

  it("sends the app key and only the search text", async () => {
    const { h, calls } = fake([{ status: 200, body: { results: [] } }]);
    await searchProducts(h, KEY, "tea kettle", signal());
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/products/search");
    expect([...url.searchParams.entries()].sort()).toEqual([["query", "tea kettle"], ["retailer", "amazon"]]);
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toBeUndefined();
  });

  it("a 429 throws unavailable with status 429", async () => {
    const { h } = fake([{ status: 429, body: { error: { code: "rate_limited" } } }]);
    await expect(searchProducts(h, KEY, "x", signal())).rejects.toMatchObject({ kind: "unavailable", status: 429 });
  });

  it("a 401 throws unauthorized", async () => {
    const { h } = fake([{ status: 401, body: { error: { code: "unauthorized" } } }]);
    await expect(searchProducts(h, KEY, "x", signal())).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("drops a bad hit and keeps the rest", async () => {
    const { h } = fake([
      {
        status: 200,
        body: { results: [{ product_id: 7 }, { title: "No id" }, "junk", { product_id: "B01", title: "Tea Kettle", price: 3500 }] },
      },
    ]);
    expect(await searchProducts(h, KEY, "x", signal())).toEqual([{ productId: "B01", title: "Tea Kettle", priceCents: 3500 }]);
  });

  it("keeps a hit whose price it can't read, with no price", async () => {
    const { h } = fake([
      {
        status: 200,
        body: {
          results: [
            { product_id: "B01", title: "Half cent", price: 12.5 },
            { product_id: "B02", title: "Text", price: "$35.00" },
            { product_id: "B03", title: "Negative", price: -100 },
            { product_id: "B04", title: "Null", price: null },
          ],
        },
      },
    ]);
    const r = await searchProducts(h, KEY, "x", signal());
    expect(r.map((x) => [x.productId, x.priceCents])).toEqual([
      ["B01", null],
      ["B02", null],
      ["B03", null],
      ["B04", null],
    ]);
  });

  it("a reply with the wrong top-level shape throws rejected", async () => {
    for (const body of [{ results: "nope" }, { nothing: [] }]) {
      const { h } = fake([{ status: 200, body }]);
      const err = await searchProducts(h, KEY, "x", signal()).catch((e) => e);
      expect(err).toBeInstanceOf(ZincError);
      expect(err).toMatchObject({ kind: "rejected" });
    }
  });

  it("an aborted signal throws unavailable and the signal reports aborted", async () => {
    const ctl = new AbortController();
    const f = ((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as unknown as typeof fetch;
    const h: ZincHttp = { base: "https://zinc.test", timeoutMs: 5000, fetch: f };
    const p = searchProducts(h, KEY, "x", ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ kind: "unavailable" });
    expect(ctl.signal.aborted).toBe(true);
  });
});

describe("productOffers", () => {
  it("offers map price, the highest shipping and the slowest delivery", async () => {
    const { h, calls } = fake([offersReply([offer()])]);
    expect(await productOffers(h, KEY, "B0TEST", signal())).toEqual([
      {
        offerId: "off_1",
        priceCents: 2499,
        shippingCents: 1299,
        available: true,
        condition: "New",
        buyBox: true,
        firstParty: false,
        sellerName: "Acme",
        handlingDaysMax: 1,
        deliveryDaysMin: 5,
        deliveryDaysMax: 8,
      },
    ]);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/products/B0TEST/offers");
    expect(url.searchParams.get("retailer")).toBe("amazon");
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
  });

  it("buyBox and firstParty are only true when exactly true", async () => {
    const { h } = fake([
      offersReply([offer({ buy_box_winner: null, seller: { name: null, first_party: true } }), offer({ buy_box_winner: null, seller: { first_party: null } })]),
    ]);
    const r = await productOffers(h, KEY, "B0TEST", signal());
    expect(r.map((o) => [o.buyBox, o.firstParty, o.sellerName])).toEqual([[false, true, null], [false, false, null]]);
  });

  it("drops an offer with a bad day count, no shipping option or a negative price, keeping the rest", async () => {
    const { h } = fake([
      offersReply([
        offer({ offer_id: "bad_days", handling_days: { min: 0, max: -1 } }),
        offer({ offer_id: "frac", handling_days: { min: 0, max: 1.5 } }),
        offer({ offer_id: "no_ship", shipping_options: [] }),
        offer({ offer_id: "neg_price", price: -1 }),
        offer({ offer_id: "good" }),
      ]),
    ]);
    const r = await productOffers(h, KEY, "B0TEST", signal());
    expect(r.map((o) => o.offerId)).toEqual(["good"]);
  });

  it("a reply with the wrong top-level shape throws rejected", async () => {
    const { h } = fake([{ status: 200, body: { offers: "nope" } }]);
    await expect(productOffers(h, KEY, "B0TEST", signal())).rejects.toMatchObject({ kind: "rejected" });
  });

  it("a 429 throws unavailable with status 429", async () => {
    const { h } = fake([{ status: 429, body: { error: { code: "rate_limited" } } }]);
    await expect(productOffers(h, KEY, "B0TEST", signal())).rejects.toMatchObject({ kind: "unavailable", status: 429 });
  });
});
