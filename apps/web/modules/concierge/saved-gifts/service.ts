import type { SaveResult } from "../settings";
import { isUuid } from "../people/rules";
import { NOT_FOUND, SESSION_ENDED, TRY_AGAIN } from "../people/service";
import type { SavedGift, SavedGiftInput } from "./rules";
import type { SavedGiftsStore } from "./store";

// Saved gifts for someone (ALL-93, planning decision 54). Events carry ids
// only, never a gift's name or link (E6).

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

const AT_CAP = "You've saved as many gifts for them as we keep. Remove one to add another.";
export const IDEA_REPLACED = "This idea was replaced. Refresh to see the new ones.";
/** The saved_gifts name limit (rules.ts, the table's check). */
const MAX_NAME = 200;
/** The saved_gifts image_url limit (the table's check). */
const MAX_IMAGE_URL = 2048;

function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String(e.message) : "";
}

/** How many gifts are saved for someone, for the row on their page (ALL-127). */
export async function countSavedGifts(store: SavedGiftsStore, personId: string): Promise<number> {
  return isUuid(personId) ? store.count(personId) : 0;
}

export async function listSavedGifts(store: SavedGiftsStore, personId: string): Promise<SavedGift[]> {
  if (!isUuid(personId)) return [];
  const rows = await store.list(personId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    productUrl: r.product_url,
    imageUrl: r.image_url,
  }));
}

export async function saveGift(store: SavedGiftsStore, log: Log, personId: string, input: SavedGiftInput): Promise<SaveResult> {
  if (!isUuid(personId)) return { ok: false, error: NOT_FOUND };
  const userId = await store.userId();
  if (!userId) return { ok: false, error: SESSION_ENDED };
  try {
    await store.insert({
      person_id: personId,
      name: input.name,
      price_cents: input.priceCents,
      product_url: input.productUrl,
      image_url: input.imageUrl,
      retailer_product_id: null,
    });
  } catch (e) {
    const code = errorCode(e);
    if (code === "P0002") return { ok: false, error: NOT_FOUND };
    if (code === "P0001" && errorMessage(e) === "saved_gifts_max") return { ok: false, error: AT_CAP };
    log("saved_gifts.save_failed", { user_id: userId, person_id: personId, code: code ?? null });
    return { ok: false, error: TRY_AGAIN };
  }
  log("saved_gifts.save", { user_id: userId, person_id: personId });
  return { ok: true };
}

/** Removing a gift that's already gone (another tab) is fine. */
export async function removeSavedGift(store: SavedGiftsStore, log: Log, personId: string, giftId: string): Promise<SaveResult> {
  if (!isUuid(personId) || !isUuid(giftId)) return { ok: false, error: NOT_FOUND };
  const userId = await store.userId();
  if (!userId) return { ok: false, error: SESSION_ENDED };
  try {
    await store.remove(personId, giftId);
  } catch (e) {
    log("saved_gifts.remove_failed", { user_id: userId, person_id: personId, code: errorCode(e) ?? null });
    return { ok: false, error: TRY_AGAIN };
  }
  log("saved_gifts.remove", { user_id: userId, person_id: personId });
  return { ok: true };
}

/** Product ids already saved for someone, so the Gift ideas screen shows "Saved" (ALL-128). */
export async function savedProductIds(store: SavedGiftsStore, personId: string): Promise<string[]> {
  return isUuid(personId) ? store.savedProductIds(personId) : [];
}

/**
 * "Save" on a suggested idea (ALL-128): copies the buyer's own on-demand idea into the person's
 * saved gifts. Only the idea's id comes from the browser; the values are read here. A second save
 * of the same product hits the one-copy index (23505) and counts as saved.
 */
export async function saveIdea(store: SavedGiftsStore, log: Log, personId: string, ideaId: string): Promise<SaveResult> {
  if (!isUuid(personId) || !isUuid(ideaId)) return { ok: false, error: NOT_FOUND };
  const userId = await store.userId();
  if (!userId) return { ok: false, error: SESSION_ENDED };
  const idea = await store.idea(ideaId);
  if (!idea) return { ok: false, error: IDEA_REPLACED };
  if (idea.person_id !== personId) {
    // Only a hand-made request gets here; the screen always sends the idea's own person.
    log("saved_gifts.save_idea_wrong_person", { user_id: userId, person_id: personId, idea_id: ideaId });
    return { ok: false, error: IDEA_REPLACED };
  }
  // By characters, so an emoji is never cut in half.
  const chars = Array.from(idea.title);
  const name = chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join("")}…` : idea.title;
  try {
    await store.insert({
      person_id: personId,
      name,
      price_cents: idea.price_cents,
      product_url: idea.product_url,
      // Zinc's photo, https only. One too long to keep is dropped rather than failing the save.
      image_url: idea.image_url !== null && idea.image_url.length <= MAX_IMAGE_URL ? idea.image_url : null,
      retailer_product_id: idea.retailer_product_id,
    });
  } catch (e) {
    const code = errorCode(e);
    if (code === "23505") return { ok: true };
    if (code === "P0002") return { ok: false, error: NOT_FOUND };
    if (code === "P0001" && errorMessage(e) === "saved_gifts_max") {
      // The cap is checked before the one-copy index, so a stale tab re-saving a saved product
      // at the cap lands here: that's still "Saved".
      const pid = idea.retailer_product_id;
      if (pid && (await store.savedProductIds(personId)).includes(pid)) return { ok: true };
      return { ok: false, error: AT_CAP };
    }
    log("saved_gifts.save_idea_failed", { user_id: userId, person_id: personId, idea_id: ideaId, code: code ?? null });
    return { ok: false, error: TRY_AGAIN };
  }
  log("saved_gifts.save_idea", { user_id: userId, person_id: personId, idea_id: ideaId });
  return { ok: true };
}
