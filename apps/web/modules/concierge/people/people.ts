import "server-only";
import type { Address, CalendarDate, OccasionKind } from "@gifts-af/core";
import type { SaveResult } from "../settings";
import type { PlaceAddressHeld } from "../zinc/types";
import type { ImportRow, PersonInput } from "./rules";
import { logEvent } from "@/lib/log";
import { resumeRoundsForPerson, type EngineDeps } from "../rounds/engine";
import * as service from "./service";
import { createSupabasePeopleStore } from "./store";

// The people API for the rest of the app: the logic in service.ts bound to the
// signed-in user's Supabase client. Server only.

export type { AddResult, ImportResult, PersonAddress, PersonCard, PersonDetail } from "./service";

export function listPeople(today: CalendarDate): Promise<service.PersonCard[]> {
  return service.listPeople(createSupabasePeopleStore(), today);
}

export function getPerson(id: string, today: CalendarDate): Promise<service.PersonDetail | null> {
  return service.getPerson(createSupabasePeopleStore(), id, today);
}

export function addPerson(input: PersonInput): Promise<service.AddResult> {
  return service.addPerson(createSupabasePeopleStore(), input);
}

/** The round engine's deps, built by the caller (app/settings/zinc-deps.ts, E3). */
export type EngineWiring = () => Promise<EngineDeps>;

// A new address can unpause a round waiting on one (ALL-28). Never affects the save.
async function resumeWaitingRounds(id: string, engine: EngineWiring): Promise<void> {
  try {
    await resumeRoundsForPerson(id, await engine());
  } catch {
    logEvent("round_resume_failed", { person_id: id });
  }
}

export async function updatePerson(id: string, input: PersonInput, engine: EngineWiring): Promise<SaveResult> {
  const result = await service.updatePerson(createSupabasePeopleStore(), id, input);
  if (result.ok) await resumeWaitingRounds(id, engine);
  return result;
}

/**
 * Saves a checked address (ALL-81); a round waiting in needs_address goes on at once, and
 * this person's gifts held for an address are placed through `placeAddressHeld` (ALL-32).
 */
export async function saveAddress(
  id: string,
  address: Address,
  wiring: { placeAddressHeld: PlaceAddressHeld; engine: EngineWiring },
): Promise<SaveResult> {
  const result = await service.saveAddress(createSupabasePeopleStore(), id, address, new Date(), wiring.placeAddressHeld);
  if (result.ok) await resumeWaitingRounds(id, wiring.engine);
  return result;
}

export function removeAddress(id: string): Promise<SaveResult> {
  return service.removeAddress(createSupabasePeopleStore(), id);
}

export function setOccasionEnabled(id: string, kind: OccasionKind, enabled: boolean): Promise<SaveResult> {
  return service.setOccasionEnabled(createSupabasePeopleStore(), id, kind, enabled);
}

export function setBudget(id: string, kind: OccasionKind, cents: number | null): Promise<SaveResult> {
  return service.setBudget(createSupabasePeopleStore(), id, kind, cents);
}

/** A linked list can bring a shared address, so this does what saving one does (ALL-63 AC-20). */
export async function linkList(
  id: string,
  token: string,
  wiring: { placeAddressHeld: PlaceAddressHeld; engine: EngineWiring },
): Promise<SaveResult> {
  const result = await service.linkList(createSupabasePeopleStore(), id, token, wiring.placeAddressHeld);
  if (result.ok) await resumeWaitingRounds(id, wiring.engine);
  return result;
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
