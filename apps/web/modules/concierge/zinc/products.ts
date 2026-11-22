// Product search and offers for the idea engine. Zinc's shapes stop here (E4):
// callers get ZincHit and ZincOffer, prices in cents. Only search text and product ids go out.
import { pickOffer, type ZincHit, type ZincOffer } from "@gifts-af/core";
import { z } from "zod";
import { call, ZincError, type ZincHttp } from "./client";

// Each hit is checked on its own, like offers: a bad hit is dropped and never fails the search.
// The search price is only a hint (offers set the real one), so one we can't read is kept as null.
const hit = z.object({ product_id: z.string(), title: z.string(), price: z.unknown().optional() });
const searchReply = z
  .object({ results: z.array(z.unknown()).optional(), products: z.array(z.unknown()).optional() })
  .refine((r) => r.results !== undefined || r.products !== undefined);
const cents = z.number().int().min(0);

export async function searchProducts(h: ZincHttp, key: string, query: string, signal: AbortSignal): Promise<ZincHit[]> {
  const r = await call(h, "GET", "/products/search", searchReply, { key, query: { retailer: "amazon", query }, signal });
  const out: ZincHit[] = [];
  for (const raw of r.results ?? r.products ?? []) {
    const p = hit.safeParse(raw);
    if (!p.success) continue;
    const price = cents.safeParse(p.data.price);
    out.push({ productId: p.data.product_id, title: p.data.title, priceCents: price.success ? price.data : null });
  }
  return out;
}

const days = z.number().int().min(0);
const offer = z.object({
  offer_id: z.string().nullish(),
  price: cents,
  available: z.boolean(),
  condition: z.string(),
  buy_box_winner: z.boolean().nullish(),
  seller: z.object({ name: z.string().nullish(), first_party: z.boolean().nullish() }),
  handling_days: z.object({ max: days }),
  shipping_options: z
    .array(z.object({ price: z.number().int(), delivery_days: z.object({ min: days, max: days }) }))
    .min(1),
});
// Each offer is checked on its own, so one bad offer is dropped and never fails the call.
const offersReply = z.object({ offers: z.array(z.unknown()) });

/**
 * Zinc's retailer slug for a lookup: "amazon", "walmart", "bestbuy", "etsy", or a Shopify
 * store's domain (Zinc takes the domain in place of a slug). Anything else is a 422.
 */
export type ZincRetailer = string;

export async function productOffers(
  h: ZincHttp,
  key: string,
  retailer: ZincRetailer,
  productId: string,
  signal: AbortSignal,
): Promise<ZincOffer[]> {
  const r = await call(h, "GET", `/products/${encodeURIComponent(productId)}/offers`, offersReply, {
    key,
    query: { retailer },
    signal,
  });
  const out: ZincOffer[] = [];
  for (const raw of r.offers) {
    const p = offer.safeParse(raw);
    if (!p.success) continue;
    const o = p.data;
    // Orders don't choose a shipping method, so judge the worst case: the slowest delivery and the highest shipping price.
    const slowest = o.shipping_options.reduce((a, b) => (b.delivery_days.max > a.delivery_days.max ? b : a));
    const shippingCents = Math.max(...o.shipping_options.map((s) => s.price));
    out.push({
      offerId: o.offer_id ?? null,
      priceCents: o.price,
      shippingCents,
      available: o.available,
      condition: o.condition,
      buyBox: o.buy_box_winner === true,
      firstParty: o.seller.first_party === true,
      sellerName: o.seller.name ?? null,
      handlingDaysMax: o.handling_days.max,
      deliveryDaysMin: slowest.delivery_days.min,
      deliveryDaysMax: slowest.delivery_days.max,
    });
  }
  return out;
}

// One product's name, price and main photo (ALL-141, ALL-29).
// Every field is nullable in Zinc's reply; anything we can't use becomes null.
const detailsReply = z.object({
  status: z.string().nullish(),
  product_id: z.string().nullish(),
  title: z.unknown().optional(),
  handle: z.unknown().optional(),
  main_image: z.unknown().optional(),
  price: z.unknown().optional(),
  currency_code: z.unknown().optional(),
  available: z.unknown().optional(),
  ship_price: z.unknown().optional(),
  // [Verify] Zinc's docs list no delivery-days field on product details; read one if it ever appears.
  delivery_days: z.unknown().optional(),
});
// https only: the photo is shown on our pages.
const webUrl = z.string().regex(/^https:\/\//i);
const deliveryDays = z.object({ max: days });

export type ZincProductDetails = {
  productId: string;
  name: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  /** Shopify only: the product handle. */
  handle?: string;
  /** The next three are there only when Zinc's reply has them. */
  available?: boolean;
  shippingCents?: number;
  deliveryDaysMax?: number;
};

/**
 * One product's details. Each call is paid ($0.01): amazonPasteDetails takes a daily quota
 * first, and listGiftQuote's caller charges its calls.
 */
export async function productDetails(
  h: ZincHttp,
  key: string,
  retailer: ZincRetailer,
  productId: string,
  signal?: AbortSignal,
): Promise<ZincProductDetails | null> {
  const r = await call(h, "GET", `/products/${encodeURIComponent(productId)}`, detailsReply, {
    key,
    query: { retailer },
    signal,
  });
  if (r.status !== "completed" || !r.product_id) return null;
  const name = typeof r.title === "string" ? r.title.trim() : "";
  // Etsy prices come in the listing's own currency, unconverted: only read dollars.
  const dollars = typeof r.currency_code !== "string" || r.currency_code.toUpperCase() === "USD";
  const price = cents.safeParse(r.price);
  const image = webUrl.safeParse(r.main_image);
  const ship = cents.safeParse(r.ship_price);
  const eta = deliveryDays.safeParse(r.delivery_days);
  return {
    productId: r.product_id,
    name: name === "" ? null : name,
    priceCents: price.success && dollars ? price.data : null,
    imageUrl: image.success ? image.data : null,
    ...(typeof r.handle === "string" ? { handle: r.handle } : {}),
    ...(typeof r.available === "boolean" ? { available: r.available } : {}),
    ...(ship.success ? { shippingCents: ship.data } : {}),
    ...(eta.success ? { deliveryDaysMax: eta.data.max } : {}),
  };
}

export type AmazonPasteDetails =
  | { kind: "found"; product: ZincProductDetails }
  | { kind: "not_found" }
  | { kind: "over_limit" };

/**
 * An Amazon link pasted on My list, looked up on the app's Zinc key (ALL-141). Each call is
 * paid, so the caller's daily allowance is a required argument and is taken before Zinc is
 * called: over the limit, or if taking it fails, Zinc is never asked. An answer for another
 * product than this ASIN counts as not found. Zinc failures throw ZincError.
 */
export async function amazonPasteDetails(
  h: ZincHttp,
  key: string,
  asin: string,
  takeQuota: () => Promise<boolean>,
  signal?: AbortSignal,
): Promise<AmazonPasteDetails> {
  if (!(await takeQuota())) return { kind: "over_limit" };
  const product = await productDetails(h, key, "amazon", asin, signal);
  if (!product || product.productId !== asin) return { kind: "not_found" };
  return { kind: "found", product };
}

/** Does Zinc say it will try this store's link? ($0.01, charged by the caller.) */
export async function checkRetailer(h: ZincHttp, key: string, url: string, signal: AbortSignal): Promise<boolean> {
  const r = await call(h, "GET", "/retailers/check", z.object({ orderable: z.boolean() }), { key, query: { url }, signal });
  return r.orderable;
}

// ─── list gifts from any store (ALL-29) ─────────────────────────────────────

export type ListGiftRoute =
  | { kind: "offers"; retailer: "amazon" | "walmart"; productId: string }
  | { kind: "details"; retailer: "etsy"; productId: string }
  // Zinc names a Shopify store by its domain, so the shop's host rides along.
  | { kind: "details"; retailer: "shopify"; shop: string; productId: string }
  | { kind: "check" };

/**
 * How to price a list gift. Zinc's id per store: Amazon the ASIN, Walmart the item id (the
 * number after /ip/), Etsy the listing id (/listing/<id>), Shopify the handle (/products/<handle>).
 * Anything else is checked.
 *
 * Best Buy goes to the check too. [Verify] Zinc's get-product docs say `retailer=bestbuy`
 * returns 400 for now, even in test mode (https://www.zinc.com/docs/v2/api-reference/products/get-product.md).
 * When Zinc opens it, add a details route (id: the SKU, `skuId` or the number before ".p").
 */
export function listGiftRoute(url: string, asin: string | null): ListGiftRoute {
  if (asin) return { kind: "offers", retailer: "amazon", productId: asin };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "check" };
  }
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  const after = (word: string) => {
    const at = segs.findIndex((s) => s.toLowerCase() === word);
    return at < 0 ? [] : segs.slice(at + 1);
  };
  if (host === "walmart.com") {
    const id = after("ip").find((s) => /^\d+$/.test(s));
    if (id) return { kind: "offers", retailer: "walmart", productId: id };
  } else if (host === "bestbuy.com") {
    return { kind: "check" };
  } else if (host === "etsy.com") {
    const id = after("listing")[0];
    if (id && /^\d+$/.test(id)) return { kind: "details", retailer: "etsy", productId: id };
  } else {
    const handle = after("products")[0];
    if (handle) {
      try {
        return { kind: "details", retailer: "shopify", shop: host, productId: decodeURIComponent(handle) };
      } catch {
        return { kind: "check" };
      }
    }
  }
  return { kind: "check" };
}

export type ListGiftQuote =
  | {
      kind: "offer";
      offer: ZincOffer;
      productId: string;
      imageUrl: string | null;
      /**
       * False when Zinc's reply had no delivery days: offer.deliveryDaysMin/Max and
       * handlingDaysMax are then 0 placeholders, and the caller must use planning_delivery_days.
       */
      deliveryKnown: boolean;
      /** False when the reply had no shipping price: offer.shippingCents is then a 0 placeholder. */
      shippingKnown: boolean;
    }
  | { kind: "listed"; priceCents: number }
  | { kind: "unsupported" }
  /** The caller's step said stop (cost cap or time): nothing more was asked of Zinc. */
  | { kind: "stopped" };

/** The caller's gate for one paid Zinc call: charge it, rate-limit it, and run it, or answer "stop". */
export type ZincStep = <T>(call: () => Promise<T>) => Promise<T | "stop">;

/**
 * Prices one list gift. At most two paid calls (offers or details, then the store check), and
 * every one goes through `step`, so the caller charges and rate-limits each. A checked store is
 * "listed" at the list's own price. No list price means nothing to show, so the check is not made.
 *
 * Logging (E6): callers log only the ZincError kind, never e.message, because the path of a
 * Shopify call holds the product handle.
 */
export async function listGiftQuote(
  h: ZincHttp,
  key: string,
  item: { url: string; asin: string | null; listPriceCents: number | null },
  step: ZincStep,
  signal: AbortSignal,
): Promise<ListGiftQuote> {
  const route = listGiftRoute(item.url, item.asin);
  if (route.kind === "offers") {
    const offers = await step(() => productOffers(h, key, route.retailer, route.productId, signal));
    if (offers === "stop") return { kind: "stopped" };
    const best = pickOffer(offers);
    return best
      ? { kind: "offer", offer: best, productId: route.productId, imageUrl: null, deliveryKnown: true, shippingKnown: true }
      : { kind: "unsupported" };
  }
  if (route.kind === "details") {
    const retailer = route.retailer === "shopify" ? route.shop : route.retailer;
    try {
      const d = await step(() => productDetails(h, key, retailer, route.productId, signal));
      if (d === "stop") return { kind: "stopped" };
      // The reply must be about the product we asked for (Shopify may answer with its numeric id, so its handle counts).
      const same = d !== null && (d.productId === route.productId || d.handle === route.productId);
      if (d && same && d.priceCents !== null) {
        const offer: ZincOffer = {
          offerId: null,
          priceCents: d.priceCents,
          shippingCents: d.shippingCents ?? 0,
          // Unknown availability counts as available on purpose: the order's price cap and its failure path cover a sold-out item.
          available: d.available ?? true,
          condition: "New",
          buyBox: true,
          firstParty: false,
          sellerName: null,
          handlingDaysMax: 0,
          deliveryDaysMin: d.deliveryDaysMax ?? 0,
          deliveryDaysMax: d.deliveryDaysMax ?? 0,
        };
        return {
          kind: "offer",
          offer,
          productId: route.productId,
          imageUrl: d.imageUrl,
          deliveryKnown: d.deliveryDaysMax !== undefined,
          shippingKnown: d.shippingCents !== undefined,
        };
      }
    } catch (e) {
      // Zinc turned the lookup down. The store check can still answer.
      if (!(e instanceof ZincError && e.kind === "rejected")) throw e;
    }
  }
  if (item.listPriceCents === null) return { kind: "unsupported" };
  const ok = await step(() => checkRetailer(h, key, item.url, signal));
  if (ok === "stop") return { kind: "stopped" };
  return ok ? { kind: "listed", priceCents: item.listPriceCents } : { kind: "unsupported" };
}
