// Product search and offers for the idea engine. Zinc's shapes stop here (E4):
// callers get ZincHit and ZincOffer, prices in cents. Only search text and product ids go out.
import type { ZincHit, ZincOffer } from "@gifts-af/core";
import { z } from "zod";
import { call, type ZincHttp } from "./client";

const hit = z.object({ product_id: z.string(), title: z.string(), price: z.number().int().nullish() });
const search = z
  .object({ results: z.array(hit).optional(), products: z.array(hit).optional() })
  .refine((r) => r.results !== undefined || r.products !== undefined);

export async function searchProducts(h: ZincHttp, key: string, query: string, signal: AbortSignal): Promise<ZincHit[]> {
  const r = await call(h, "GET", "/products/search", search, { key, query: { retailer: "amazon", query }, signal });
  return (r.results ?? r.products ?? []).map((x) => ({ productId: x.product_id, title: x.title, priceCents: x.price ?? null }));
}

const days = z.number().int().min(0);
const offer = z.object({
  offer_id: z.string().nullish(),
  price: z.number().int(),
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
    const fastest = o.shipping_options.reduce((a, b) => (b.delivery_days.max < a.delivery_days.max ? b : a));
    out.push({
      offerId: o.offer_id ?? null,
      priceCents: o.price,
      shippingCents: fastest.price,
      available: o.available,
      condition: o.condition,
      buyBox: o.buy_box_winner === true,
      firstParty: o.seller.first_party === true,
      sellerName: o.seller.name ?? null,
      handlingDaysMax: o.handling_days.max,
      deliveryDaysMin: fastest.delivery_days.min,
      deliveryDaysMax: fastest.delivery_days.max,
    });
  }
  return out;
}
