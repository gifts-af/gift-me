import "server-only";
import type { Address, CalendarDate, OccasionKind } from "@gifts-af/core";
import type { SaveResult } from "../settings";
import type { PlaceAddressHeld } from "../zinc/types";
import type { ImportRow, MonthDay, PersonInput } from "./rules";
import { logEvent } from "@/lib/log";
import * as service from "./service";
import { createSupabasePeopleStore } from "./store";

// The people API for the rest of the app: the logic in service.ts bound to the
// signed-in user's Supabase client. Server only.

export type { AddResult, DatedKind, ImportResult, PersonAddress, PersonCard, PersonDetail } from "./service";

export function listPeople(today: CalendarDate): Promise<service.PersonCard[]> {
  return service.listPeople(createSupabasePeopleStore(), today);
}

export function getPerson(id: string, today: CalendarDate): Promise<service.PersonDetail | null> {
  return service.getPerson(createSupabasePeopleStore(), id, today);
}

/** With a share token, the person is also linked to that list, in one transaction (ALL-123). */
export function addPerson(input: PersonInput, shareToken?: string): Promise<service.AddResult> {
  return service.addPerson(createSupabasePeopleStore(), input, shareToken);
}

// About's fields, one at a time (ALL-127). None of these moves rounds on.
export function renamePerson(id: string, name: string): Promise<SaveResult> {
  return service.renamePerson(createSupabasePeopleStore(), id, name);
}

export function setRelationship(id: string, relationship: string): Promise<SaveResult> {
  return service.setRelationship(createSupabasePeopleStore(), id, relationship);
}

export function setBirthYear(id: string, year: number | null, currentYear: number): Promise<SaveResult> {
  return service.setBirthYear(createSupabasePeopleStore(), id, year, currentYear);
}

export function setDatedOccasion(id: string, kind: service.DatedKind, date: MonthDay): Promise<SaveResult> {
  return service.setDatedOccasion(createSupabasePeopleStore(), id, kind, date);
}

export function removeDatedOccasion(id: string, kind: service.DatedKind): Promise<SaveResult> {
  return service.removeDatedOccasion(createSupabasePeopleStore(), id, kind);
}

/**
 * Saves a checked address (ALL-81), and this person's gifts held for an address are placed
 * through `placeAddressHeld` (ALL-32). A round waiting in needs_address goes on at the next
 * daily tick, which has the time for its idea run (ALL-27).
 */
export async function saveAddress(id: string, address: Address, wiring: { placeAddressHeld: PlaceAddressHeld }): Promise<SaveResult> {
  return service.saveAddress(createSupabasePeopleStore(), id, address, new Date(), wiring.placeAddressHeld);
}

export function removeAddress(id: string): Promise<SaveResult> {
  return service.removeAddress(createSupabasePeopleStore(), id);
}

export function setOccasionEnabled(id: string, kind: OccasionKind, enabled: boolean): Promise<SaveResult> {
  return service.setOccasionEnabled(createSupabasePeopleStore(), id, kind, enabled);
}

/** The Budget screen's one save (ALL-120). */
export function saveBudgets(id: string, amounts: Record<string, number | null>): Promise<SaveResult> {
  return service.saveBudgets(createSupabasePeopleStore(), logEvent, id, amounts);
}

export function linkList(id: string, token: string): Promise<SaveResult> {
  return service.linkList(createSupabasePeopleStore(), id, token);
}

export function unlinkList(id: string): Promise<SaveResult> {
  return service.unlinkList(createSupabasePeopleStore(), id);
}

export function setPhoto(id: string, path: string | null): Promise<SaveResult> {
  return service.setPhoto(createSupabasePeopleStore(), id, path);
}

export function deletePerson(id: string): Promise<SaveResult> {
  return service.deletePerson(createSupabasePeopleStore(), id);
}

/** Adds ticked Google contacts (ALL-24); photos are copied from Google's photo host. */
export function importPeople(rows: ImportRow[]): Promise<service.ImportResult> {
  return service.importPeople(createSupabasePeopleStore(), rows, { fetch, newId: () => crypto.randomUUID() });
}

/** Google contact ids already imported, for the checklist's "Already added". */
export function listImportedContactIds(): Promise<string[]> {
  return createSupabasePeopleStore().importedContactIds();
}
