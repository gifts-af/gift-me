// Product search and offers for the idea engine. Zinc's shapes stop here (E4):
// callers get ZincHit and ZincOffer, prices in cents. Only search text and product ids go out.
import type { ZincHit, ZincOffer } from "@gifts-af/core";
import { z } from "zod";
import { call, type ZincHttp } from "./client";

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

export async function productOffers(h: ZincHttp, key: string, productId: string, signal: AbortSignal): Promise<ZincOffer[]> {
  const r = await call(h, "GET", `/products/${encodeURIComponent(productId)}/offers`, offersReply, {
    key,
    query: { retailer: "amazon" },
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
