import type { NewSavedGift, SavedGiftRow, SavedGiftsStore } from "../saved-gifts/store";

export const ME = "me-id";
export const MY_PERSON = "11111111-1111-4111-8111-111111111111";
export const NOT_MINE = "22222222-2222-4222-8222-222222222222";

function dbError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * An in-memory SavedGiftsStore. It mirrors only the two errors the database
 * trigger raises (supabase/tests/saved_gifts.test.sql covers the real ones):
 * P0002 for a person that isn't the caller's or is deleted, and P0001
 * `saved_gifts_max` at the cap.
 */
export class FakeSavedGiftsStore implements SavedGiftsStore {
  caller: string | null = ME;
  people = new Set([MY_PERSON]);
  max = 100;
  rows: SavedGiftRow[] = [];
  writes: string[] = [];
  nextId = 1;

  async userId() {
    return this.caller;
  }

  async list(personId: string) {
    return this.rows.filter((r) => r.person_id === personId);
  }

  async insert(gift: NewSavedGift) {
    if (!this.people.has(gift.person_id)) throw dbError("Person not found", "P0002");
    if (this.rows.filter((r) => r.person_id === gift.person_id).length >= this.max) {
      throw dbError("saved_gifts_max", "P0001");
    }
    this.writes.push(`insert ${gift.name}`);
    const n = String(this.nextId++).padStart(12, "0");
    this.rows.unshift({ id: `33333333-3333-4333-8333-${n}`, created_at: new Date().toISOString(), ...gift });
  }

  async remove(personId: string, giftId: string) {
    this.writes.push(`remove ${giftId}`);
    this.rows = this.rows.filter((r) => !(r.id === giftId && r.person_id === personId));
  }
}
