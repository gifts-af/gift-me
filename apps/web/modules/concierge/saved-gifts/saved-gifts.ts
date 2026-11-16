import "server-only";
import type { SaveResult } from "../settings";
import { logEvent } from "@/lib/log";
import type { SavedGift, SavedGiftInput } from "./rules";
import * as service from "./service";
import { createSupabaseSavedGiftsStore } from "./store";

// The saved-gifts API for the rest of the app (ALL-93): service.ts bound to
// the signed-in user's Supabase client. Server only.

export function countSavedGifts(personId: string): Promise<number> {
  return service.countSavedGifts(createSupabaseSavedGiftsStore(), personId);
}

export function listSavedGifts(personId: string): Promise<SavedGift[]> {
  return service.listSavedGifts(createSupabaseSavedGiftsStore(), personId);
}

export function saveGift(personId: string, input: SavedGiftInput): Promise<SaveResult> {
  return service.saveGift(createSupabaseSavedGiftsStore(), logEvent, personId, input);
}

export function removeSavedGift(personId: string, giftId: string): Promise<SaveResult> {
  return service.removeSavedGift(createSupabaseSavedGiftsStore(), logEvent, personId, giftId);
}
