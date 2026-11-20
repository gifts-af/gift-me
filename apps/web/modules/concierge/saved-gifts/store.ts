import "server-only";
import { createClient } from "@/lib/supabase/server";

// Saved gifts as the signed-in user, so Row Level Security applies. The
// database trigger refuses another user's or a deleted person (P0002) and a
// person at the cap (P0001 saved_gifts_max); errors are thrown as they come.

export type SavedGiftRow = {
  id: string;
  person_id: string;
  name: string;
  price_cents: number | null;
  product_url: string | null;
  image_url: string | null;
  /** The product id of an idea it was copied from (ALL-128); null when typed in by hand. */
  retailer_product_id: string | null;
  created_at: string;
};

export type NewSavedGift = Omit<SavedGiftRow, "id" | "created_at">;

/** What "Save" copies from one of a person's on-demand ideas (ALL-128). */
export type IdeaToSave = {
  person_id: string | null;
  title: string;
  price_cents: number;
  product_url: string | null;
  retailer_product_id: string | null;
};

export interface SavedGiftsStore {
  userId(): Promise<string | null>;
  /** Newest first. */
  list(personId: string): Promise<SavedGiftRow[]>;
  /** How many, without loading them. */
  count(personId: string): Promise<number>;
  insert(gift: NewSavedGift): Promise<void>;
  remove(personId: string, giftId: string): Promise<void>;
  /** One of the caller's on-demand ideas (RLS), or null once a newer run replaced it. */
  idea(ideaId: string): Promise<IdeaToSave | null>;
  /** Product ids of the gifts saved for a person, for "Saved" on the Gift ideas screen. */
  savedProductIds(personId: string): Promise<string[]>;
}

export function createSupabaseSavedGiftsStore(): SavedGiftsStore {
  const client = createClient();
  const table = async () => (await client).schema("concierge").from("saved_gifts");
  return {
    async userId() {
      const { data } = await (await client).auth.getClaims();
      const sub = data?.claims?.sub;
      return typeof sub === "string" ? sub : null;
    },
    async list(personId) {
      const { data, error } = await (await table())
        .select("id, person_id, name, price_cents, product_url, image_url, retailer_product_id, created_at")
        .eq("person_id", personId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async count(personId) {
      const { count, error } = await (await table()).select("id", { count: "exact", head: true }).eq("person_id", personId);
      if (error) throw error;
      return count ?? 0;
    },
    async insert(gift) {
      const { error } = await (await table()).insert(gift);
      if (error) throw error;
    },
    async remove(personId, giftId) {
      const { error } = await (await table()).delete().eq("id", giftId).eq("person_id", personId);
      if (error) throw error;
    },
    async idea(ideaId) {
      const { data, error } = await (await client)
        .schema("concierge")
        .from("gift_ideas")
        .select("person_id, title, price_cents, product_url, retailer_product_id")
        .eq("id", ideaId)
        .is("round_id", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async savedProductIds(personId) {
      const { data, error } = await (await table())
        .select("retailer_product_id")
        .eq("person_id", personId)
        .not("retailer_product_id", "is", null);
      if (error) throw error;
      return (data ?? []).flatMap((r) => (r.retailer_product_id ? [r.retailer_product_id] : []));
    },
  };
}
