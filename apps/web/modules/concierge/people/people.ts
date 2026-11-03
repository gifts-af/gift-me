import "server-only";
import type { Address, CalendarDate, OccasionKind } from "@gifts-af/core";
import type { SaveResult } from "../settings";
import type { ImportRow, PersonInput } from "./rules";
import { logEvent } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { defaultChannels } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { resumeRoundsForPerson } from "../rounds/engine";
import { createStubGenerateIdeas } from "../rounds/ideas";
import { createSupabaseRoundStore } from "../rounds/store";
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

// A new address can unpause a round waiting on one (ALL-28). Never affects the save.
async function resumeWaitingRounds(id: string): Promise<void> {
  try {
    const now = new Date();
    await resumeRoundsForPerson(id, {
      store: createSupabaseRoundStore(),
      notify: { store: createSupabaseNotifyStore(), channels: defaultChannels(), baseUrl: siteUrl(), now },
      now,
      generateIdeas: createStubGenerateIdeas({ production: process.env.VERCEL_ENV === "production" }),
    });
  } catch {
    logEvent("round_resume_failed", { person_id: id });
  }
}

export async function updatePerson(id: string, input: PersonInput): Promise<SaveResult> {
  const result = await service.updatePerson(createSupabasePeopleStore(), id, input);
  if (result.ok) await resumeWaitingRounds(id);
  return result;
}

/** Saves a checked address (ALL-81); a round waiting in needs_address goes on at once. */
export async function saveAddress(id: string, address: Address): Promise<SaveResult> {
  const result = await service.saveAddress(createSupabasePeopleStore(), id, address, new Date());
  if (result.ok) await resumeWaitingRounds(id);
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
