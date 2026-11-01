import "server-only";
import type { CalendarDate, OccasionKind } from "@gifts-af/core";
import type { SaveResult } from "../settings";
import type { ImportRow, PersonInput } from "./rules";
import * as service from "./service";
import { createSupabasePeopleStore } from "./store";

// The people API for the rest of the app: the logic in service.ts bound to the
// signed-in user's Supabase client. Server only.

export type { AddResult, ImportResult, PersonCard, PersonDetail } from "./service";

export function listPeople(today: CalendarDate): Promise<service.PersonCard[]> {
  return service.listPeople(createSupabasePeopleStore(), today);
}

export function getPerson(id: string, today: CalendarDate): Promise<service.PersonDetail | null> {
  return service.getPerson(createSupabasePeopleStore(), id, today);
}

export function addPerson(input: PersonInput): Promise<service.AddResult> {
  return service.addPerson(createSupabasePeopleStore(), input);
}

export function updatePerson(id: string, input: PersonInput): Promise<SaveResult> {
  return service.updatePerson(createSupabasePeopleStore(), id, input);
}

export function setOccasionEnabled(id: string, kind: OccasionKind, enabled: boolean): Promise<SaveResult> {
  return service.setOccasionEnabled(createSupabasePeopleStore(), id, kind, enabled);
}

export function setBudget(id: string, kind: OccasionKind, cents: number | null): Promise<SaveResult> {
  return service.setBudget(createSupabasePeopleStore(), id, kind, cents);
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
