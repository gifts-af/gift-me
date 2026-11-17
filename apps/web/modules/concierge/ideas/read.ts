import type { CalendarDate } from "@gifts-af/core";
import { hasPaidFeatures } from "../paid-features";
import type { Db } from "../profile/profile";

// A person's on-demand ideas for the Gift ideas screen (ALL-27). Read with the
// signed-in user's client, so RLS shows only their own rows (decision 54).

export type ShownIdea = {
  id: string;
  title: string;
  retailer: string | null;
  productUrl: string | null;
  retailerProductId: string | null;
  sellerName: string | null;
  totalCents: number;
  arriveBy: CalendarDate | null;
  reason: string | null;
  overBudget: boolean;
};

export async function onDemandIdeas(db: Db, personId: string): Promise<ShownIdea[]> {
  const { data, error } = await db
    .schema("concierge")
    .from("gift_ideas")
    .select("id, title, retailer, product_url, retailer_product_id, seller_name, est_total_cents, arrive_by, reason, over_budget")
    .eq("person_id", personId)
    .is("round_id", null)
    .order("rank");
  if (error) throw new Error(`Couldn't load gift ideas: ${error.message}`);
  return data.map((i) => ({
    id: i.id,
    title: i.title,
    retailer: i.retailer,
    productUrl: i.product_url,
    retailerProductId: i.retailer_product_id,
    sellerName: i.seller_name,
    totalCents: i.est_total_cents,
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
 * What the Suggest button's money notice says (AC-14), as captureReadOffer does for reading
 * captures: null, so no button, unless the engine is on and the signed-in buyer has paid features.
 */
export async function ideaRunOffer(db: Db): Promise<{ estimateCents: number; maxCents: number } | null> {
  const userId = (await db.auth.getClaims()).data?.claims?.sub;
  if (!userId) return null;
  const [on, paid] = await Promise.all([setting(db, "idea_engine_enabled"), hasPaidFeatures(db, userId)]);
  if (on !== 1 || !paid) return null;
  const [estimateCents, maxCents] = await Promise.all([setting(db, "idea_run_estimate_cents"), setting(db, "idea_run_max_cents")]);
  return { estimateCents, maxCents };
}
