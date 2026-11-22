import { describe, expect, it, vi } from "vitest";
import { ZincError, type ZincHttp } from "../zinc/client";
import {
  amazonPasteDetails,
  checkRetailer,
  listGiftQuote,
  listGiftRoute,
  productDetails,
  productOffers,
  searchProducts,
} from "../zinc/products";
import { FakeZinc } from "./fake-zinc";

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
    expect(await productOffers(h, KEY, "amazon", "B0TEST", signal())).toEqual([
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
    const r = await productOffers(h, KEY, "amazon", "B0TEST", signal());
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
    const r = await productOffers(h, KEY, "amazon", "B0TEST", signal());
    expect(r.map((o) => o.offerId)).toEqual(["good"]);
  });

  it("a reply with the wrong top-level shape throws rejected", async () => {
    const { h } = fake([{ status: 200, body: { offers: "nope" } }]);
    await expect(productOffers(h, KEY, "amazon", "B0TEST", signal())).rejects.toMatchObject({ kind: "rejected" });
  });

  it("a 429 throws unavailable with status 429", async () => {
    const { h } = fake([{ status: 429, body: { error: { code: "rate_limited" } } }]);
    await expect(productOffers(h, KEY, "amazon", "B0TEST", signal())).rejects.toMatchObject({ kind: "unavailable", status: 429 });
  });
});

describe("productDetails (ALL-141)", () => {
  const details = (over: Record<string, unknown> = {}) => ({
    status: 200,
    body: {
      status: "completed",
      product_id: "B0G5Z36T3N",
      title: "  SOULWIT Headband Protector  ",
      main_image: "https://m.media-amazon.com/images/I/51jwXyqEB3L.jpg",
      price: 1195,
      retailer: "amazon",
      feature_bullets: ["ignored"],
      ...over,
    },
  });

  it("asks for one Amazon product and maps its name, price and photo", async () => {
    const { h, calls } = fake([details()]);
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toEqual({
      productId: "B0G5Z36T3N",
      name: "SOULWIT Headband Protector",
      priceCents: 1195,
      imageUrl: "https://m.media-amazon.com/images/I/51jwXyqEB3L.jpg",
    });
    expect(calls).toEqual([
      { method: "GET", url: "https://zinc.test/products/B0G5Z36T3N?retailer=amazon", auth: `Bearer ${KEY}`, body: undefined },
    ]);
  });

  it("is null unless the lookup is completed", async () => {
    for (const status of ["processing", "failed", null]) {
      const { h } = fake([details({ status })]);
      expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toBeNull();
    }
  });

  it("is null without a product id", async () => {
    const { h } = fake([details({ product_id: null })]);
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toBeNull();
  });

  it("keeps the product when the name, price or photo is missing or unusable (photos are https only)", async () => {
    const { h } = fake([
      details({ title: "   ", price: null, main_image: null }),
      details({ title: null, price: -5, main_image: "javascript:alert(1)" }),
      details({ title: undefined, price: 12.5, main_image: "data:image/png;base64,AAAA" }),
      details({ price: "1195", main_image: "http://example.com/a.jpg" }),
      details({ main_image: "HTTPS://m.media-amazon.com/images/I/b.jpg" }),
    ]);
    const none = { productId: "B0G5Z36T3N", name: null, priceCents: null, imageUrl: null };
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toEqual(none);
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toEqual(none);
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toEqual(none);
    expect(await productDetails(h, KEY, "amazon", "B0G5Z36T3N")).toEqual({
      productId: "B0G5Z36T3N",
      name: "SOULWIT Headband Protector",
      priceCents: null,
      imageUrl: null,
    });
    expect((await productDetails(h, KEY, "amazon", "B0G5Z36T3N"))?.imageUrl).toBe("HTTPS://m.media-amazon.com/images/I/b.jpg");
  });

  it("a reply that isn't an object throws rejected", async () => {
    const { h } = fake([{ status: 200, body: "nope" }]);
    await expect(productDetails(h, KEY, "amazon", "B0G5Z36T3N")).rejects.toMatchObject({ kind: "rejected" });
  });

  it("a 503 throws unavailable", async () => {
    const { h } = fake([{ status: 503 }]);
    await expect(productDetails(h, KEY, "amazon", "B0G5Z36T3N")).rejects.toBeInstanceOf(ZincError);
  });
});

describe("amazonPasteDetails (ALL-141)", () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    status: 200,
    body: { status: "completed", product_id: "B0G5Z36T3N", title: "Headband", main_image: null, price: 1195, ...over },
  });
  const ok = () => vi.fn(async () => true);

  it("takes the quota first, then asks Zinc", async () => {
    const { h, calls } = fake([reply()]);
    const takeQuota = vi.fn(async () => {
      expect(calls).toHaveLength(0);
      return true;
    });
    expect(await amazonPasteDetails(h, KEY, "B0G5Z36T3N", takeQuota)).toEqual({
      kind: "found",
      product: { productId: "B0G5Z36T3N", name: "Headband", priceCents: 1195, imageUrl: null },
    });
    expect(takeQuota).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("never calls Zinc over the limit", async () => {
    const { h, calls } = fake([]);
    expect(await amazonPasteDetails(h, KEY, "B0G5Z36T3N", vi.fn(async () => false))).toEqual({ kind: "over_limit" });
    expect(calls).toHaveLength(0);
  });

  it("never calls Zinc when the quota fails", async () => {
    const { h, calls } = fake([]);
    const takeQuota = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(amazonPasteDetails(h, KEY, "B0G5Z36T3N", takeQuota)).rejects.toThrow("db down");
    expect(calls).toHaveLength(0);
  });

  it("is not_found when Zinc answers for another product, or has none", async () => {
    const { h } = fake([reply({ product_id: "B0OTHER000" }), reply({ status: "failed" })]);
    expect(await amazonPasteDetails(h, KEY, "B0G5Z36T3N", ok())).toEqual({ kind: "not_found" });
    expect(await amazonPasteDetails(h, KEY, "B0G5Z36T3N", ok())).toEqual({ kind: "not_found" });
  });
});

describe("listGiftRoute (ALL-29)", () => {
  it("an Amazon gift goes by its ASIN", () => {
    expect(listGiftRoute("https://www.amazon.com/dp/B0TEST1234", "B0TEST1234")).toEqual({
      kind: "offers",
      retailer: "amazon",
      productId: "B0TEST1234",
    });
  });
  it("Walmart, Best Buy and Etsy go by the id in the link", () => {
    expect(listGiftRoute("https://www.walmart.com/ip/Some-Kettle/123456789", null)).toEqual({
      kind: "offers",
      retailer: "walmart",
      productId: "123456789",
    });
    expect(listGiftRoute("https://www.bestbuy.com/site/some-tv/6525410.p?skuId=6525410", null)).toEqual({
      kind: "details",
      retailer: "bestbuy",
      productId: "6525410",
    });
    expect(listGiftRoute("https://www.etsy.com/listing/987654321/handmade-mug", null)).toEqual({
      kind: "details",
      retailer: "etsy",
      productId: "987654321",
    });
  });
  it("a Shopify /products/ link goes by its handle and the shop's domain", () => {
    expect(listGiftRoute("https://yetch.store/products/blue-mug?variant=1", null)).toEqual({
      kind: "details",
      retailer: "shopify",
      shop: "yetch.store",
      productId: "blue-mug",
    });
  });
  it("anything else is checked", () => {
    expect(listGiftRoute("https://www.target.com/p/thing/-/A-1", null)).toEqual({ kind: "check" });
    expect(listGiftRoute("not a url", null)).toEqual({ kind: "check" });
  });
});

describe("checkRetailer (ALL-29)", () => {
  it("asks Zinc about the url and reads orderable", async () => {
    const { h, calls } = fake([{ status: 200, body: { orderable: true, support: "active" } }]);
    expect(await checkRetailer(h, KEY, "https://shop.example/p/1", signal())).toBe(true);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/retailers/check");
    expect(u.searchParams.get("url")).toBe("https://shop.example/p/1");
  });
  it("a store Zinc will not try is false", async () => {
    const { h } = fake([{ status: 200, body: { orderable: false, support: "unsupported" } }]);
    expect(await checkRetailer(h, KEY, "https://shop.example/p/1", signal())).toBe(false);
  });
});

describe("listGiftQuote (ALL-29)", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    url: "https://www.amazon.com/dp/B0TEST1234",
    asin: "B0TEST1234" as string | null,
    listPriceCents: 3000 as number | null,
    ...over,
  });

  it("an Amazon list gift is priced through offers with its ASIN", async () => {
    const { h, calls } = fake([offersReply([offer()])]);
    const q = await listGiftQuote(h, KEY, item(), signal());
    expect(q).toMatchObject({ kind: "offer", productId: "B0TEST1234", imageUrl: null, offer: { priceCents: 2499 } });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/products/B0TEST1234/offers");
    expect(u.searchParams.get("retailer")).toBe("amazon");
  });

  it("a Walmart link uses offers with the walmart retailer", async () => {
    const { h, calls } = fake([offersReply([offer()])]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.walmart.com/ip/Kettle/123456789", asin: null }), signal());
    expect(q).toMatchObject({ kind: "offer", productId: "123456789" });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/products/123456789/offers");
    expect(u.searchParams.get("retailer")).toBe("walmart");
  });

  it("a Best Buy link uses product details", async () => {
    const { h, calls } = fake([
      { status: 200, body: { status: "completed", product_id: "6525410", title: "TV", price: 49999, main_image: "https://img.test/a.jpg" } },
    ]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.bestbuy.com/site/tv/6525410.p?skuId=6525410", asin: null }), signal());
    expect(q).toMatchObject({ kind: "offer", productId: "6525410", imageUrl: "https://img.test/a.jpg", offer: { priceCents: 49999, available: true } });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/products/6525410");
    expect(u.searchParams.get("retailer")).toBe("bestbuy");
  });

  it("a Shopify /products/ link uses product details", async () => {
    const { h, calls } = fake([{ status: 200, body: { status: "completed", product_id: "blue-mug", price: 2200, available: true } }]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://yetch.store/products/blue-mug", asin: null }), signal());
    expect(q).toMatchObject({ kind: "offer", offer: { priceCents: 2200 } });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/products/blue-mug");
    expect(u.searchParams.get("retailer")).toBe("yetch.store");
  });

  it("details that say unavailable make an unavailable offer", async () => {
    const { h } = fake([{ status: 200, body: { status: "completed", product_id: "blue-mug", price: 2200, available: false } }]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://yetch.store/products/blue-mug", asin: null }), signal());
    expect(q).toMatchObject({ kind: "offer", offer: { available: false } });
  });

  it("another store passes the check and is listed at its list price", async () => {
    const { h, calls } = fake([{ status: 200, body: { orderable: true } }]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.target.com/p/x", asin: null }), signal());
    expect(q).toEqual({ kind: "listed", priceCents: 3000 });
    expect(new URL(calls[0].url).pathname).toBe("/retailers/check");
  });

  it("a store the check refuses is unsupported", async () => {
    const { h } = fake([{ status: 200, body: { orderable: false } }]);
    expect(await listGiftQuote(h, KEY, item({ url: "https://www.target.com/p/x", asin: null }), signal())).toEqual({ kind: "unsupported" });
  });

  it("no list price is unsupported, and the check is not paid for", async () => {
    const { h, calls } = fake([]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.target.com/p/x", asin: null, listPriceCents: null }), signal());
    expect(q).toEqual({ kind: "unsupported" });
    expect(calls).toHaveLength(0);
  });

  it("an http photo is dropped", async () => {
    const { h } = fake([{ status: 200, body: { status: "completed", product_id: "6525410", price: 100, main_image: "http://img.test/a.jpg" } }]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.bestbuy.com/site/tv/6525410.p", asin: null }), signal());
    expect(q).toMatchObject({ kind: "offer", imageUrl: null });
  });

  it("no usable offer is unsupported", async () => {
    const { h } = fake([offersReply([offer({ available: false })])]);
    expect(await listGiftQuote(h, KEY, item(), signal())).toEqual({ kind: "unsupported" });
  });

  it("details Zinc rejects fall back to the check", async () => {
    const { h, calls } = fake([
      { status: 400, body: { error: { code: "invalid_request" } } },
      { status: 200, body: { orderable: true } },
    ]);
    const q = await listGiftQuote(h, KEY, item({ url: "https://www.bestbuy.com/site/tv/6525410.p", asin: null }), signal());
    expect(q).toEqual({ kind: "listed", priceCents: 3000 });
    expect(calls).toHaveLength(2);
  });
});

describe("productDetails shipping and currency (ALL-29)", () => {
  it("returns shipping when the reply has it", async () => {
    const { h } = fake([{ status: 200, body: { status: "completed", product_id: "B1", price: 1000, ship_price: 499 } }]);
    expect(await productDetails(h, KEY, "amazon", "B1")).toMatchObject({ shippingCents: 499 });
  });
  it("an Etsy price in another currency is not read as dollars", async () => {
    const { h } = fake([{ status: 200, body: { status: "completed", product_id: "9", price: 1000, currency_code: "GBP" } }]);
    expect(await productDetails(h, KEY, "etsy", "9")).toMatchObject({ priceCents: null });
  });
});

describe("the fake Zinc (ALL-29)", () => {
  const post = (z: FakeZinc, max: number, ref: string) =>
    z.fetch("https://zinc.test/orders", {
      method: "POST",
      headers: { Authorization: "Bearer k" },
      body: JSON.stringify({
        idempotency_key: ref,
        max_price: max,
        metadata: { order_id: ref },
        products: [{ url: "https://shop.test/p/1" }],
        shipping_address: { city: "X" },
      }),
    });

  it("refuses an order capped below the price", async () => {
    const z = new FakeZinc(() => true);
    z.products.set("https://shop.test/p/1", { priceCents: 5000 });
    expect((await post(z, 4000, "low")).status).toBe(200);
    expect(z.orders.get("low")).toMatchObject({ status: "order_failed", job_result: { success: false, error_type: "max_price_exceeded" } });
    expect((await post(z, 6000, "ok")).status).toBe(200);
    expect(z.orders.get("ok")?.status).toBe("processing");
  });

  it("answers the check and the product routes", async () => {
    const z = new FakeZinc(() => true);
    z.products.set("https://shop.test/p/1", { priceCents: 5000 });
    const get = (p: string) => z.fetch(`https://zinc.test${p}`, { headers: { Authorization: "Bearer k" } });
    expect(await (await get(`/retailers/check?url=${encodeURIComponent("https://shop.test/p/1")}`)).json()).toMatchObject({ orderable: true });
    expect(await (await get(`/retailers/check?url=${encodeURIComponent("https://nope.test/x")}`)).json()).toMatchObject({ orderable: false });
    z.catalog.set("walmart:77", { priceCents: 1234 });
    const offers = await (await get("/products/77/offers?retailer=walmart")).json();
    expect(offers.offers[0]).toMatchObject({ price: 1234, available: true });
    const details = await (await get("/products/77?retailer=walmart")).json();
    expect(details).toMatchObject({ status: "completed", product_id: "77", price: 1234 });
  });
});
