import type { CalendarDate } from "@gifts-af/core";
import { hasPaidFeatures } from "../paid-features";
import { ideaTotalCents, readPayer } from "../purchase/payer";
import type { Db } from "../profile/profile";

// A person's on-demand ideas for the Gift ideas screen (ALL-27). Read with the
// signed-in user's client, so RLS shows only their own rows (decision 54).

export type ShownIdea = {
  id: string;
  title: string;
  retailer: string | null;
  productUrl: string | null;
  /** The product's photo from Zinc, https only (ALL-29 AC-17). */
  imageUrl: string | null;
  retailerProductId: string | null;
  sellerName: string | null;
  /** The item alone. */
  priceCents: number;
  /** What it costs this buyer: the item, shipping and estimated tax, plus the wallet's order fee or, by card, the GiftsAF fee. */
  totalCents: number;
  arriveBy: CalendarDate | null;
  reason: string | null;
  overBudget: boolean;
};

export async function onDemandIdeas(db: Db, personId: string): Promise<ShownIdea[]> {
  const { data, error } = await db
    .schema("concierge")
    .from("gift_ideas")
    .select("id, title, retailer, product_url, image_url, retailer_product_id, seller_name, price_cents, est_total_cents, goods_cents, arrive_by, reason, over_budget")
    .eq("person_id", personId)
    .is("round_id", null)
    .order("rank");
  if (error) throw new Error(`Couldn't load gift ideas: ${error.message}`);
  if (data.length === 0) return [];
  // RLS showed only the signed-in user's ideas, so the payer is theirs.
  const userId = (await db.auth.getClaims()).data?.claims?.sub;
  if (!userId) throw new Error("Gift ideas were read without a signed-in user.");
  const payer = await readPayer({ db, now: new Date() }, userId);
  return data.map((i) => ({
    id: i.id,
    title: i.title,
    retailer: i.retailer,
    productUrl: i.product_url,
    imageUrl: i.image_url,
    retailerProductId: i.retailer_product_id,
    sellerName: i.seller_name,
    priceCents: i.price_cents,
    totalCents: ideaTotalCents(i, payer),
    arriveBy: i.arrive_by,
    reason: i.reason,
    overBudget: i.over_budget,
  }));
}

async function setting(db: Db, key: string): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) throw new Error(`Reading setting ${key} failed: ${error.message}`);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

/**
 * Whether the Gift ideas screen offers a run (AC-14): "ready" with what the money notice says,
 * "off" while idea_engine_enabled is 0 (for everyone), or "not_paid" for a buyer without paid
 * features. Only "ready" shows the button.
 */
export type IdeaRunOffer = { kind: "ready"; estimateCents: number; maxCents: number } | { kind: "off" } | { kind: "not_paid" };

export async function ideaRunOffer(db: Db): Promise<IdeaRunOffer> {
  const userId = (await db.auth.getClaims()).data?.claims?.sub;
  if (!userId) return { kind: "not_paid" };
  const [on, paid] = await Promise.all([setting(db, "idea_engine_enabled"), hasPaidFeatures(db, userId)]);
  if (on !== 1) return { kind: "off" };
  if (!paid) return { kind: "not_paid" };
  const [estimateCents, maxCents] = await Promise.all([setting(db, "idea_run_estimate_cents"), setting(db, "idea_run_max_cents")]);
  return { kind: "ready", estimateCents, maxCents };
}
