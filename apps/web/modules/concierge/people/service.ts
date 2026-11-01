// The people logic (ALL-21): reads and mutations, written against a
// PeopleStore so it can be tested without a database. people.ts binds it to
// the real one. Every mutation first confirms the person is the caller's own
// live person (the database's row-level security says the same, but a
// refused write must come back as a clear error, not a silent no-op).
import {
  isGooglePhotoUrl,
  nextOccasion,
  nextOccurrence,
  orderBy,
  sizedGooglePhotoUrl,
  startingOccasions,
  type CalendarDate,
  type OccasionKind,
  type Relationship,
} from "@gifts-af/core";
import type { SaveResult } from "../settings";
import { isUuid, parseShareToken, type ImportRow, type MonthDay, type PersonInput } from "./rules";
import type { OccasionRow, PeopleStore, PersonRow } from "./store";

export type PersonCard = {
  id: string;
  name: string;
  relationship: Relationship;
  photoUrl: string | null;
  next: { kind: OccasionKind; date: CalendarDate } | null;
  keepsList: boolean;
  hasBirthday: boolean;
};

export type PersonDetail = PersonCard & {
  /** The storage path of the photo, for the picker to replace. */
  photoPath: string | null;
  birthYear: number | null;
  birthday: MonthDay | null;
  anniversary: MonthDay | null;
  occasions: {
    kind: OccasionKind;
    enabled: boolean;
    date: CalendarDate;
    orderBy: { date: CalendarDate; fast: boolean } | null;
    budgetCents: number | null;
  }[];
};

export type AddResult = { ok: true; id: string } | { ok: false; error: string };

// The largest value of the database's integer column: a true constant.
const MAX_BUDGET_CENTS = 2147483647;

const NOT_FOUND = "That person wasn't found.";
const SESSION_ENDED = "Your session ended. Sign in again.";
const TRY_AGAIN = "That couldn't be saved. Try again.";
const DATED_KINDS: OccasionKind[] = ["birthday", "anniversary"];
// Any of these can be switched on for anyone; relationships only set the start.
const HOLIDAYS: OccasionKind[] = ["christmas", "valentines_day", "mothers_day", "fathers_day"];

function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

function rule(o: Pick<OccasionRow, "kind" | "month" | "day">) {
  return o.kind === "birthday" || o.kind === "anniversary"
    ? { kind: o.kind, month: o.month ?? 0, day: o.day ?? 0 }
    : { kind: o.kind };
}

function monthDay(o: OccasionRow | undefined): MonthDay | null {
  return o && o.month !== null && o.day !== null ? { month: o.month, day: o.day } : null;
}

function cardOf(p: PersonRow, occasions: OccasionRow[], today: CalendarDate, photos: Map<string, string>): PersonCard {
  return {
    id: p.id,
    name: p.name,
    relationship: p.relationship as Relationship,
    photoUrl: p.photoPath ? (photos.get(p.photoPath) ?? null) : null,
    next: nextOccasion(occasions, today),
    keepsList: p.linkedUserId !== null,
    hasBirthday: occasions.some((o) => o.kind === "birthday"),
  };
}

/** The caller's people, soonest next occasion first, then by name; none last. */
export async function listPeople(store: PeopleStore, today: CalendarDate): Promise<PersonCard[]> {
  const people = await store.people();
  const occasions = await store.occasions(people.map((p) => p.id));
  const paths = people.flatMap((p) => (p.photoPath ? [p.photoPath] : []));
  const photos = await store.signPhotos(paths);

  const cards = people.map((p) =>
    cardOf(p, occasions.filter((o) => o.personId === p.id), today, photos),
  );
  return cards.sort((a, b) => {
    if (a.next && b.next && a.next.date !== b.next.date) return a.next.date < b.next.date ? -1 : 1;
    if (!a.next !== !b.next) return a.next ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** One person with everything the detail screen shows; null if not the caller's. */
export async function getPerson(store: PeopleStore, id: string, today: CalendarDate): Promise<PersonDetail | null> {
  if (!isUuid(id)) return null; // not an id we could have issued; skip the query
  const person = await store.person(id);
  if (!person) return null;
  const [occasions, budgets, schedule, photos] = await Promise.all([
    store.occasions([id]),
    store.budgets([id]),
    store.schedule(),
    store.signPhotos(person.photoPath ? [person.photoPath] : []),
  ]);

  // Every holiday gets a row so the page can show a switch for each: ones the
  // person doesn't have yet appear switched off. All rows are in date order.
  const missing = HOLIDAYS.filter((k) => !occasions.some((o) => o.kind === k)).map((kind) => ({
    id: "", personId: id, kind, month: null, day: null, enabled: false,
  }));
  const rows = [...occasions, ...missing]
    .map((o) => {
      const date = nextOccurrence(rule(o), today);
      return {
        kind: o.kind,
        enabled: o.enabled,
        date,
        orderBy: o.enabled ? orderBy(date, today, schedule) : null,
        budgetCents: budgets.find((b) => b.kind === o.kind)?.cents ?? null,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    ...cardOf(person, occasions, today, photos),
    photoPath: person.photoPath,
    birthYear: person.birthYear,
    birthday: monthDay(occasions.find((o) => o.kind === "birthday")),
    anniversary: monthDay(occasions.find((o) => o.kind === "anniversary")),
    occasions: rows,
  };
}

export async function addPerson(store: PeopleStore, input: PersonInput): Promise<AddResult> {
  const kinds = startingOccasions(input.relationship, {
    birthday: input.birthday !== null,
    anniversary: input.anniversary !== null,
  });
  try {
    const id = await store.createPerson({
      name: input.name,
      relationship: input.relationship,
      kinds,
      birthday: input.birthday,
      birthYear: input.birthYear,
      anniversary: input.anniversary,
    });
    return { ok: true, id };
  } catch (e) {
    console.error("adding a person failed", e);
    return { ok: false, error: "That person couldn't be saved. Try again." };
  }
}

/** Runs a mutation on one of the caller's own people; anything else is an error. */
async function onOwnPerson(
  store: PeopleStore,
  id: string,
  what: string,
  run: (person: PersonRow) => Promise<SaveResult>,
): Promise<SaveResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  try {
    const person = await store.person(id);
    if (!person) return { ok: false, error: NOT_FOUND };
    return await run(person);
  } catch (e) {
    if (errorCode(e) === "P0002") return { ok: false, error: NOT_FOUND };
    console.error(`${what} failed`, e);
    return { ok: false, error: TRY_AGAIN };
  }
}

const notFound = (): SaveResult => ({ ok: false, error: NOT_FOUND });

// Brings one dated occasion (birthday or anniversary) in line with the form.
async function syncDated(
  store: PeopleStore,
  personId: string,
  kind: "birthday" | "anniversary",
  want: MonthDay | null,
  existing: OccasionRow | undefined,
): Promise<boolean> {
  if (want && !existing) {
    await store.addOccasion(personId, { kind, ...want });
  } else if (want && existing && (existing.month !== want.month || existing.day !== want.day)) {
    return store.moveOccasion(existing.id, want.month, want.day);
  } else if (!want && existing) {
    await store.removeOccasion(existing.id);
  }
  return true;
}

export function updatePerson(store: PeopleStore, id: string, input: PersonInput): Promise<SaveResult> {
  return onOwnPerson(store, id, "updating a person", async () => {
    const changed = await store.updatePerson(id, {
      name: input.name,
      relationship: input.relationship,
      birthYear: input.birthYear,
    });
    if (!changed) return notFound();

    // Only the birthday and anniversary rows follow the form; every other
    // occasion, and each switch, stays as it is.
    const existing = await store.occasions([id]);
    const wanted = { birthday: input.birthday, anniversary: input.anniversary };
    for (const kind of DATED_KINDS as ("birthday" | "anniversary")[]) {
      const ok = await syncDated(store, id, kind, wanted[kind], existing.find((o) => o.kind === kind));
      if (!ok) return notFound();
    }
    return { ok: true };
  });
}

export function setOccasionEnabled(
  store: PeopleStore,
  id: string,
  kind: OccasionKind,
  enabled: boolean,
): Promise<SaveResult> {
  return onOwnPerson(store, id, "switching an occasion", async () => {
    const occasion = (await store.occasions([id])).find((o) => o.kind === kind);
    if (!occasion) {
      if (!HOLIDAYS.includes(kind)) return { ok: false, error: "Add their date first, then switch it on." };
      if (!enabled) return { ok: true };
      await store.addOccasion(id, { kind, month: null, day: null });
      return { ok: true };
    }
    return (await store.setEnabled(occasion.id, enabled)) ? { ok: true } : notFound();
  });
}

export function setBudget(
  store: PeopleStore,
  id: string,
  kind: OccasionKind,
  cents: number | null,
): Promise<SaveResult> {
  if (cents !== null) {
    if (!Number.isInteger(cents) || cents < 0) {
      return Promise.resolve({ ok: false, error: "Enter an amount like 75 or 75.50." });
    }
    if (cents > MAX_BUDGET_CENTS) return Promise.resolve({ ok: false, error: "That amount is too large." });
  }
  return onOwnPerson(store, id, "saving a budget", async () => {
    await store.upsertBudget(id, kind, cents);
    return { ok: true };
  });
}

export function linkList(store: PeopleStore, id: string, link: string): Promise<SaveResult> {
  const token = parseShareToken(link);
  if (!token) {
    return Promise.resolve({ ok: false, error: "Paste the share link from their GiftsAF list." });
  }
  return onOwnPerson(store, id, "linking a list", async () => {
    try {
      await store.linkList(token, id);
      return { ok: true };
    } catch (e) {
      const code = errorCode(e);
      if (code === "P0002") return { ok: false, error: "That link doesn't match a GiftsAF list." };
      if (code === "22023") return { ok: false, error: "That's your own list." };
      throw e;
    }
  });
}

export function unlinkList(store: PeopleStore, id: string): Promise<SaveResult> {
  return onOwnPerson(store, id, "unlinking a list", async () => {
    await store.unlinkList(id);
    return { ok: true };
  });
}

export async function setPhoto(store: PeopleStore, id: string, path: string | null): Promise<SaveResult> {
  const userId = await store.userId();
  if (!userId) return { ok: false, error: SESSION_ENDED };
  // Photos live at <user_id>/<person_id>/<file>: nothing else may be saved.
  const folder = `${userId}/${id}/`;
  if (path !== null && (!path.startsWith(folder) || path.slice(folder.length).includes("/") || path.includes(".."))) {
    return { ok: false, error: "That photo couldn't be saved. Try again." };
  }
  return onOwnPerson(store, id, "saving a photo", async () =>
    (await store.setPhotoPath(id, path)) ? { ok: true } : notFound(),
  );
}

export function deletePerson(store: PeopleStore, id: string): Promise<SaveResult> {
  return onOwnPerson(store, id, "deleting a person", async () => {
    await store.deletePerson(id);
    return { ok: true };
  });
}

// ─── Google Contacts import (ALL-24) ────────────────────────────────────────

export type ImportResult =
  | { ok: true; added: number; skipped: number; failed: number; photosMissed: number }
  | { ok: false; error: string };

export type ImportDeps = {
  fetch: typeof fetch;
  /** A fresh file name for each copied photo. */
  newId: () => string;
};

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type PhotoCopySettings = {
  px: number;
  maxBytes: number;
  /** Per photo fetch, in milliseconds. */
  timeoutMs: number;
  /** Photos copied at once. */
  concurrency: number;
};

/** The body, or null once it passes `maxBytes` (stops reading there). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

/**
 * Copies a contact's Google photo into the buyer's own folder. Only Google's
 * photo host is ever fetched (the row checks say so too), redirects are
 * refused, each fetch has a timeout, and anything that isn't a small image is
 * dropped without reading past the size limit. Never throws.
 */
async function copyPhoto(
  store: PeopleStore,
  deps: ImportDeps,
  userId: string,
  personId: string,
  url: string,
  size: PhotoCopySettings,
): Promise<boolean> {
  if (!isGooglePhotoUrl(url)) return false;
  try {
    const res = await deps.fetch(sizedGooglePhotoUrl(url, size.px), {
      redirect: "error",
      signal: AbortSignal.timeout(size.timeoutMs),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = PHOTO_TYPES[type];
    const stated = Number(res.headers.get("content-length") ?? "0");
    if (!res.ok || !ext || stated > size.maxBytes) {
      await res.body?.cancel();
      return false;
    }
    const bytes = await readCapped(res, size.maxBytes);
    if (!bytes || bytes.byteLength === 0) return false;
    const path = `${userId}/${personId}/${deps.newId()}.${ext}`;
    if (!(await store.uploadPhoto(path, bytes, type))) return false;
    return await store.setPhotoPath(personId, path);
  } catch (e) {
    console.error("copying a contact photo failed", e);
    return false;
  }
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runner = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner));
}

/**
 * Adds the ticked contacts; each one stands alone, so one failure doesn't stop
 * the rest. People are added first, then their photos are copied a few at a
 * time, so a slow photo never holds up the people.
 */
export async function importPeople(store: PeopleStore, rows: ImportRow[], deps: ImportDeps): Promise<ImportResult> {
  const userId = await store.userId();
  if (!userId) return { ok: false, error: SESSION_ENDED };
  let imported: Set<string>;
  let size: PhotoCopySettings;
  try {
    [imported, size] = await Promise.all([
      store.importedContactIds().then((ids) => new Set(ids)),
      store.photoSettings(),
    ]);
  } catch (e) {
    console.error("starting an import failed", e);
    return { ok: false, error: TRY_AGAIN };
  }

  const result = { ok: true as const, added: 0, skipped: 0, failed: 0, photosMissed: 0 };
  const photos: { id: string; url: string }[] = [];
  for (const row of rows) {
    if (imported.has(row.googleId)) {
      result.skipped++;
      continue;
    }
    try {
      const id = await store.createPerson({
        name: row.name,
        relationship: row.relationship,
        kinds: startingOccasions(row.relationship, { birthday: row.birthday !== null, anniversary: false }),
        birthday: row.birthday,
        birthYear: row.birthYear,
        anniversary: null,
        googleContactId: row.googleId,
        address: row.address,
      });
      imported.add(row.googleId);
      result.added++;
      if (row.photoUrl) photos.push({ id, url: row.photoUrl });
    } catch (e) {
      // The unique index: another import added them a moment ago.
      if (errorCode(e) === "23505") result.skipped++;
      else {
        console.error("importing a person failed", e);
        result.failed++;
      }
    }
  }
  await inBatches(photos, size.concurrency, async ({ id, url }) => {
    if (!(await copyPhoto(store, deps, userId, id, url, size))) result.photosMissed++;
  });
  return result;
}
