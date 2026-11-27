"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { appSettingInt } from "@/lib/app-settings";
import { logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addFromExtension,
  extensionAddStoreFor,
  getSharedList,
  linkUnlinkedPerson,
  readStoredPhoto,
  setGiftImageUrl,
  storedPhotoId,
  unlinkPerson,
  UUID_PATTERN,
} from "@/modules/lists";

// The card on a shared list (ALL-123). The lists module does the work and logs
// its own failures; these log only the successes (E6: ids only).

type Result = { ok: true } | { ok: false; error: string };

async function userId(): Promise<string | null> {
  return (await (await createClient()).auth.getClaims()).data?.claims?.sub ?? null;
}

// Both ids are checked before any work, so a forged call can't make the server
// revalidate an arbitrary path (E4).
function validIds(token: unknown, personId: unknown): boolean {
  return typeof token === "string" && typeof personId === "string" && UUID_PATTERN.test(token) && UUID_PATTERN.test(personId);
}

function refresh(token: string, personId: string) {
  revalidatePath(`/share/${token}`);
  revalidatePath(`/people/${personId}`);
}

/** Link one of the buyer's people, who has no list yet, to this list. Never replaces a link. */
export async function linkFromShareAction(token: string, personId: string): Promise<Result> {
  if (!validIds(token, personId)) return { ok: false, error: "That didn't save. Try again." };
  const result = await linkUnlinkedPerson(token, personId);
  if (!result.ok) return { ok: false, error: result.error };
  logEvent("lists.linked_from_share", { user_id: await userId(), person_id: personId, list_id: result.listId });
  refresh(token, personId);
  return { ok: true };
}

/**
 * Remove the buyer's person's list link. The person, occasions and budgets stay.
 * The token is used only to refresh this page: unlink_person acts on the
 * caller's own person whatever list it's linked to, which is harmless.
 */
export async function unlinkFromShareAction(token: string, personId: string): Promise<Result> {
  if (!validIds(token, personId)) return { ok: false, error: "That didn't save. Try again." };
  const result = await unlinkPerson(personId);
  if (!result.ok) return result;
  logEvent("lists.unlinked_from_share", { user_id: await userId(), person_id: personId });
  refresh(token, personId);
  return { ok: true };
}

export type AddFromShareResult = { ok: true } | { ok: false; error: string };

const ADD_FAILED = "Couldn't add that gift. Try again.";

/**
 * "+ My list": copy one gift from a shared list to the viewer's own list, through
 * add_item like the extension, so the item limit and the duplicate key apply. The
 * gift is read through get_shared_list, so only a gift on a list shared right now
 * can be copied, and claims are never read. A duplicate counts as done. A stored
 * photo is copied into the new gift's own file, because the original is deleted
 * with its gift. Logs one lists.added_from_share event, ids only (E6).
 */
export async function addFromShareAction(token: string, itemId: string): Promise<AddFromShareResult> {
  if (!validIds(token, itemId)) return { ok: false, error: ADD_FAILED };
  try {
    const list = await getSharedList(token);
    if (!list) return { ok: false, error: "This list isn't shared any more." };
    if (list.isOwner) return { ok: false, error: "This is already your list." };
    if (!list.viewer.signedIn) return { ok: false, error: "Sign in to add gifts to your list." };
    const gift = list.items.find((item) => item.id === itemId);
    if (!gift) return { ok: false, error: "That gift isn't on this list any more." };

    const db = await createClient();
    const uid = (await db.auth.getClaims()).data?.claims?.sub;
    if (!uid) return { ok: false, error: "Sign in to add gifts to your list." };
    const [photoMaxBytes, maxItems] = await Promise.all([
      appSettingInt("list_photo_max_bytes", db),
      appSettingInt("list_max_items", db),
    ]);

    let adminClient: ReturnType<typeof createAdminClient> | null = null;
    const admin = () => (adminClient ??= createAdminClient());
    const store = extensionAddStoreFor(db, uid, admin);
    const photoId = storedPhotoId(gift.imageUrl);
    const photo = photoId ? await readStoredPhoto(admin(), photoId).catch(() => null) : null;

    const newId = randomUUID();
    const result = await addFromExtension(store, {
      itemId: newId,
      name: gift.name,
      priceCents: gift.priceCents,
      link: gift.productUrl,
      productId: null,
      // A copy of the same gift: only the exact link counts as already there.
      confirmLikely: true,
      photo,
      photoMaxBytes,
      maxItems,
      event: "lists.added_from_share",
    });
    const body = result.body;
    if ("error" in body) return { ok: false, error: ADD_FAILED };
    if (body.outcome === "full") return { ok: false, error: "Your list is full. Remove a gift to add this one." };
    if (body.outcome === "added" && gift.imageUrl && !photoId) {
      // A store's own photo link: add_item takes only a stored photo, so it's set after. Best effort.
      await setGiftImageUrl(db, newId, gift.imageUrl).catch(() => {});
    }
    return { ok: true };
  } catch (error) {
    logEvent("lists.added_from_share", {
      outcome: "failed",
      item_id: itemId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, error: ADD_FAILED };
  }
}
