import type { CalendarDate } from "@gifts-af/core";
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
