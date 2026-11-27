import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import type { AddItemRow, ExtensionAddStore } from "./extension-add";

// The extension add's store (ALL-78). add_item runs as the user, from the
// extension's bearer token, so RLS applies. The photo queue and the
// list-photos bucket are closed to users, so those go through the service
// role. The route builds both clients (E3).

const BUCKET = "list-photos";
const photoPath = (itemId: string) => `${itemId}.jpg`;

/** A Postgres error as an Error that keeps its code, so the caller can tell a unique violation. */
function dbError(what: string, error: { code?: string }): Error {
  return Object.assign(new Error(`${what} failed`), { code: error.code });
}

/** The store over the user's client; the service-role client is made only when a photo needs it. */
export function extensionAddStoreFor(
  user: SupabaseClient<Database>,
  userId: string,
  makeAdmin: () => SupabaseClient<Database>,
): ExtensionAddStore {
  let adminClient: SupabaseClient<Database> | null = null;
  const admin = () => (adminClient ??= makeAdmin());

  return {
    userId,
    async queuePhoto(itemId) {
      const { error } = await admin().schema("lists").rpc("queue_photo", { p_item_id: itemId });
      if (error) throw dbError("queue_photo", error);
    },
    async uploadPhoto(itemId, jpeg) {
      const bucket = admin().storage.from(BUCKET);
      const { error } = await bucket.upload(photoPath(itemId), jpeg, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("Uploading the photo failed");
      return bucket.getPublicUrl(photoPath(itemId)).data.publicUrl;
    },
    async deletePhoto(itemId) {
      const { error } = await admin().storage.from(BUCKET).remove([photoPath(itemId)]);
      if (error) throw new Error("Deleting the photo failed");
    },
    async addItem(args): Promise<AddItemRow> {
      const { data, error } = await user.schema("lists").rpc("add_item", {
        p_item_id: args.itemId,
        p_name: args.name,
        p_price_cents: args.priceCents,
        // The generated types don't mark these nullable; add_item takes null for none.
        p_product_url: args.productUrl as string,
        p_product_id: args.productId as string,
        p_photo_url: args.photoUrl as string,
        p_confirm_likely: args.confirmLikely,
        p_max_items: args.maxItems,
      });
      if (error) throw dbError("add_item", error);
      const row = data?.[0];
      if (!row) throw new Error("add_item returned no row");
      return {
        outcome: row.outcome,
        listId: row.list_id,
        itemId: row.item_id,
        existing: row.existing && typeof row.existing === "object" && !Array.isArray(row.existing) ? row.existing : null,
      };
    },
  };
}
