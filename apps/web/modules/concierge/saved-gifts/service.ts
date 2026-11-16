import type { SaveResult } from "../settings";
import { isUuid } from "../people/rules";
import { NOT_FOUND, SESSION_ENDED, TRY_AGAIN } from "../people/service";
import type { SavedGift, SavedGiftInput } from "./rules";
import type { SavedGiftsStore } from "./store";

// Saved gifts for someone (ALL-93, planning decision 54). Events carry ids
// only, never a gift's name or link (E6).

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

const AT_CAP = "You've saved as many gifts for them as we keep. Remove one to add another.";

function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String(e.message) : "";
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
