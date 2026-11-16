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
  created_at: string;
};

export type NewSavedGift = Omit<SavedGiftRow, "id" | "created_at">;

export interface SavedGiftsStore {
  userId(): Promise<string | null>;
  /** Newest first. */
  list(personId: string): Promise<SavedGiftRow[]>;
  insert(gift: NewSavedGift): Promise<void>;
  remove(personId: string, giftId: string): Promise<void>;
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
        .select("id, person_id, name, price_cents, product_url, image_url, created_at")
        .eq("person_id", personId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async insert(gift) {
      const { error } = await (await table()).insert(gift);
      if (error) throw error;
    },
    async remove(personId, giftId) {
      const { error } = await (await table()).delete().eq("id", giftId).eq("person_id", personId);
      if (error) throw error;
    },
  };
}
