import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";

// Photos for a gift copied from someone else's shared list. A stored photo
// (list-photos/<gift id>.jpg) is deleted with its gift, so the copy gets its
// own file: the bytes are read from the bucket by id, never fetched from a URL.
// A store's own photo link is kept as it is.

const BUCKET = "list-photos";
const STORED = /\/storage\/v1\/object\/public\/list-photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/i;

/** The gift id naming a stored list photo, or null for a store's own photo link (or none). */
export function storedPhotoId(imageUrl: string | null): string | null {
  return imageUrl?.match(STORED)?.[1] ?? null;
}

/** Service role: a stored photo's bytes, or null when it can't be read (the copy then has no photo). */
export async function readStoredPhoto(admin: SupabaseClient<Database>, photoId: string): Promise<Blob | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(`${photoId}.jpg`);
  return error || !data ? null : data;
}

/** As the user: give their new gift a store's photo link. add_item takes only its own stored photo. */
export async function setGiftImageUrl(db: SupabaseClient<Database>, itemId: string, imageUrl: string): Promise<void> {
  const { error } = await db.schema("lists").from("list_items").update({ image_url: imageUrl }).eq("id", itemId);
  if (error) throw new Error("Setting the photo failed");
}
