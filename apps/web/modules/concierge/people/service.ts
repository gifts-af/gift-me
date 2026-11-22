// The people logic (ALL-21): reads and mutations, written against a
// PeopleStore so it can be tested without a database. people.ts binds it to
// the real one. Every mutation first confirms the person is the caller's own
// live person (the database's row-level security says the same, but a
// refused write must come back as a clear error, not a silent no-op).
import {
  BASE_BUDGET_KIND,
  checkAddress,
  isGooglePhotoUrl,
  nextOccasion,
  nextOccurrence,
  orderBy,
  sizedGooglePhotoUrl,
  startingOccasions,
  type CalendarDate,
  type OccasionKind,
  type Address,
  type AddressDraft,
  type AddressField,
  type Relationship,
} from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import type { SaveResult } from "../settings";
import type { PlaceAddressHeld } from "../zinc/types";
import {
  BAD_DATE,
  checkBirthYear,
  checkName,
  checkRelationship,
  isRealMonthDay,
  isUuid,
  parseShareToken,
  type ImportRow,
  type MonthDay,
  type PersonInput,
} from "./rules";
import type { OccasionRow, PeopleStore, PersonFields, PersonRow, StoredAddress } from "./store";

export type PersonCard = {
  id: string;
  name: string;
  relationship: Relationship;
  photoUrl: string | null;
  next: { kind: OccasionKind; date: CalendarDate } | null;
  keepsList: boolean;
  hasBirthday: boolean;
};

/** What the person page's Shipping address section shows (ALL-81). */
export type PersonAddress =
  | { kind: "none" }
  /** The buyer's own entry; `problems` is empty when it's complete. */
  | { kind: "own"; address: AddressDraft; problems: Partial<Record<AddressField, string>> }
  /** The list owner shares their own address: city and state only, never the street (decision 38). */
  | { kind: "shared"; city: string; state: string };

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
    /** This occasion's own budget; null means it uses the base, then the default (ALL-120). */
    budgetCents: number | null;
  }[];
  /** The person's base budget, for any occasion without its own (ALL-120). */
  baseBudgetCents: number | null;
  /** The caller's default for this person's relationship (budget_defaults), used when there's no base. */
  defaultBudgetCents: number | null;
  address: PersonAddress;
};

/** `existingId`: the person already added from this list link (ALL-123); the form opens them. */
export type AddResult = { ok: true; id: string } | { ok: false; error: string; existingId?: string };

// The largest value of the database's integer column: a true constant.

export const NOT_FOUND = "That person wasn't found.";
export const SESSION_ENDED = "Your session ended. Sign in again.";
export const TRY_AGAIN = "That couldn't be saved. Try again.";
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
  const [occasions, budgets, defaultBudgetCents, schedule, photos, stored, shared] = await Promise.all([
    store.occasions([id]),
    store.budgets([id]),
    store.relationshipDefault(person.relationship),
    store.schedule(),
    store.signPhotos(person.photoPath ? [person.photoPath] : []),
    store.address(id),
    store.sharedCity(id),
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
    baseBudgetCents: budgets.find((b) => b.kind === BASE_BUDGET_KIND)?.cents ?? null,
    defaultBudgetCents,
    address: personAddress(stored, shared),
  };
}

const ADDRESS_KEYS: AddressField[] = ["firstName", "lastName", "line1", "line2", "city", "state", "zip"];

function personAddress(stored: StoredAddress | null, shared: { city: string; state: string } | null): PersonAddress {
  if (shared) return { kind: "shared", ...shared };
  if (!stored || ADDRESS_KEYS.every((k) => !stored[k])) return { kind: "none" };
  const address = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, stored[k] ?? null])) as AddressDraft;
  const checked = checkAddress(address);
  return { kind: "own", address, problems: checked.ok ? {} : checked.errors };
}

const LINK_NO_LONGER_WORKS = "This list link no longer works. Ask them for a new one.";

/** The already-linked person's id when add_person refused with list_has_person (ALL-123). */
function listHasPerson(e: unknown): string | null {
  if (errorCode(e) !== "P0001" || !(e instanceof Error) || !e.message.includes("list_has_person")) return null;
  const details = (e as { details?: unknown }).details;
  return typeof details === "string" && isUuid(details) ? details : null;
}

/**
 * Adds a person. With a share token (from a shared list's link, ALL-123),
 * the person is linked to that list in the same transaction, so two Saves at
 * once make one person, never two (T18).
 */
export async function addPerson(store: PeopleStore, input: PersonInput, shareToken?: string): Promise<AddResult> {
  // A malformed token would fail Postgres's uuid cast; it's just a dead link.
  if (shareToken !== undefined && !isUuid(shareToken)) return { ok: false, error: LINK_NO_LONGER_WORKS };
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
      ...(shareToken !== undefined && { shareToken }),
    });
    if (shareToken !== undefined) {
      // list_id isn't returned by add_person; the person id finds the link.
      const userId = await store.userId().catch(() => null);
      logEvent("people.added_from_share", { user_id: userId, person_id: id });
    }
    return { ok: true, id };
  } catch (e) {
    if (shareToken !== undefined) {
      const existingId = listHasPerson(e);
      if (existingId) {
        const existing = await store.person(existingId).catch(() => null);
        return { ok: false, error: `${existing?.name ?? "This person"} is already in your people.`, existingId };
      }
      if (errorCode(e) === "P0002") return { ok: false, error: LINK_NO_LONGER_WORKS };
      if (errorCode(e) === "22023") return { ok: false, error: "That's your own list." };
    }
    logEvent("person.add_failed", { from_share: shareToken !== undefined, ...errorFields(e) });
    return { ok: false, error: "That person couldn't be saved. Try again." };
  }
}

/** Runs a mutation on one of the caller's own people; anything else is an error. */
async function onOwnPerson(
  store: PeopleStore,
  id: string,
  run: (person: PersonRow) => Promise<SaveResult>,
  /** Logs a failure as one event with ids and the code only (E6): an error message can carry personal data. */
  onError: (e: unknown) => void = (e) => logEvent("person.save_failed", { person_id: id, code: errorCode(e) ?? null }),
): Promise<SaveResult> {
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  try {
    const person = await store.person(id);
    if (!person) return { ok: false, error: NOT_FOUND };
    return await run(person);
  } catch (e) {
    if (errorCode(e) === "P0002") return { ok: false, error: NOT_FOUND };
    onError(e);
    return { ok: false, error: TRY_AGAIN };
  }
}

const notFound = (): SaveResult => ({ ok: false, error: NOT_FOUND });

// ─── About: one field at a time (ALL-127, T71) ─────────────────────────────
// Each saves only its own field and never moves rounds on: a name or a date
// can't place an order.

export type DatedKind = "birthday" | "anniversary";

function writeFields(store: PeopleStore, id: string, fields: PersonFields): Promise<SaveResult> {
  return onOwnPerson(store, id, async () =>
    (await store.updatePersonFields(id, fields)) ? { ok: true } : notFound(),
  );
}

export function renamePerson(store: PeopleStore, id: string, name: string): Promise<SaveResult> {
  const checked = checkName(name);
  if (!checked.ok) return Promise.resolve(checked);
  return writeFields(store, id, { name: checked.value });
}

export function setRelationship(store: PeopleStore, id: string, relationship: string): Promise<SaveResult> {
  const checked = checkRelationship(relationship);
  if (!checked.ok) return Promise.resolve(checked);
  return writeFields(store, id, { relationship: checked.value });
}

/** The birth year, or null to clear it; from 1900 to `currentYear`. A year needs a birthday. */
export function setBirthYear(store: PeopleStore, id: string, year: number | null, currentYear: number): Promise<SaveResult> {
  const checked = checkBirthYear(year, currentYear);
  if (!checked.ok) return Promise.resolve(checked);
  if (checked.value === null) return writeFields(store, id, { birthYear: null });
  return onOwnPerson(store, id, async () => {
    const hasBirthday = (await store.occasions([id])).some((o) => o.kind === "birthday");
    if (!hasBirthday) return { ok: false, error: NO_BIRTHDAY };
    return (await store.updatePersonFields(id, { birthYear: checked.value })) ? { ok: true } : notFound();
  });
}

const NO_BIRTHDAY = "Add a birthday first.";

/**
 * Sets a birthday or anniversary. An existing one is moved, keeping its id,
 * switch and any open round; one is added only when there's none. Only a real
 * date is saved.
 */
export function setDatedOccasion(store: PeopleStore, id: string, kind: DatedKind, date: MonthDay): Promise<SaveResult> {
  if (!isRealMonthDay(date)) return Promise.resolve({ ok: false, error: BAD_DATE });
  return onOwnPerson(store, id, async () => {
    const existing = (await store.occasions([id])).find((o) => o.kind === kind);
    if (!existing) {
      await store.addOccasion(id, { kind, month: date.month, day: date.day });
      return { ok: true };
    }
    if (existing.month === date.month && existing.day === date.day) return { ok: true };
    return (await store.moveOccasion(existing.id, date.month, date.day)) ? { ok: true } : notFound();
  });
}

/**
 * "Remove birthday" or "Remove anniversary". Removing the birthday clears the
 * birth year first, then the occasion (two writes; a failure between leaves
 * the birthday without a year, which is harmless).
 */
export function removeDatedOccasion(store: PeopleStore, id: string, kind: DatedKind): Promise<SaveResult> {
  return onOwnPerson(store, id, async () => {
    if (kind === "birthday" && !(await store.updatePersonFields(id, { birthYear: null }))) return notFound();
    const existing = (await store.occasions([id])).find((o) => o.kind === kind);
    if (existing) await store.removeOccasion(existing.id);
    return { ok: true };
  });
}

const SHARED_ADDRESS = "Their address is kept by them.";

/** Writes the address (or clears it); refused while the list owner shares theirs (ALL-81). Ids only in logs (E6). */
function writeAddress(store: PeopleStore, id: string, a: (Address & { checkedAt: string }) | null): Promise<SaveResult> {
  return onOwnPerson(
    store,
    id,
    async () => {
      if (await store.sharedCity(id)) return { ok: false, error: SHARED_ADDRESS };
      return (await store.saveAddress(id, a)) ? { ok: true } : notFound();
    },
    (e) => logEvent("person_address_failed", { person_id: id, code: errorCode(e) ?? null }),
  );
}

/**
 * Saves a checked address as a US address, checked at `now` (T51). Then this
 * person's gifts held for an address are tried again (`placeAddressHeld`), so
 * they ship to the new address (ALL-32 AC-21); nothing else the buyer has held
 * is placed from a form save. That never affects the save.
 */
export async function saveAddress(
  store: PeopleStore,
  id: string,
  a: Address,
  now: Date,
  placeAddressHeld?: PlaceAddressHeld,
): Promise<SaveResult> {
  const result = await writeAddress(store, id, { ...a, checkedAt: now.toISOString() });
  if (result.ok && placeAddressHeld) {
    const userId = await store.userId();
    try {
      if (userId) await placeAddressHeld(userId, id);
    } catch (e) {
      logEvent("person_address_place_failed", { person_id: id, user_id: userId, ...errorFields(e) });
    }
  }
  return result;
}

/** Clears every address column at once (AC-6). */
export function removeAddress(store: PeopleStore, id: string): Promise<SaveResult> {
  return writeAddress(store, id, null);
}

export function setOccasionEnabled(
  store: PeopleStore,
  id: string,
  kind: OccasionKind,
  enabled: boolean,
): Promise<SaveResult> {
  return onOwnPerson(store, id, async () => {
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

/** The Budget screen's one save (ALL-120): the base and occasion amounts, all or nothing. */
export async function saveBudgets(
  store: PeopleStore,
  log: (event: string, fields: Record<string, string>) => void,
  id: string,
  amounts: Record<string, number | null>,
): Promise<SaveResult> {
  const userId = await store.userId();
  return onOwnPerson(store, id, async () => {
    await store.saveBudgets(id, amounts);
    log("budgets.save", { user_id: userId ?? "", person_id: id });
    return { ok: true };
  });
}

export function linkList(store: PeopleStore, id: string, link: string): Promise<SaveResult> {
  const token = parseShareToken(link);
  if (!token) {
    return Promise.resolve({ ok: false, error: "Paste the share link from their GiftsAF list." });
  }
  return onOwnPerson(store, id, async () => {
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
  return onOwnPerson(store, id, async () => {
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
  return onOwnPerson(store, id, async () =>
    (await store.setPhotoPath(id, path)) ? { ok: true } : notFound(),
  );
}

export function deletePerson(store: PeopleStore, id: string): Promise<SaveResult> {
  return onOwnPerson(store, id, async () => {
    await store.deletePerson(id);
    return { ok: true };
  });
}

// ─── Google Contacts import (ALL-24) ────────────────────────────────────────

export type ImportResult =
  | { ok: true; added: number; skipped: number; failed: number; photosMissed: number; firstAdded?: { id: string; name: string } | null }
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
    logEvent("people.contact_photo_failed", { person_id: personId, ...errorFields(e) });
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
    logEvent("people.import_start_failed", errorFields(e));
    return { ok: false, error: TRY_AGAIN };
  }

  const result = { ok: true as const, added: 0, skipped: 0, failed: 0, photosMissed: 0, firstAdded: null as { id: string; name: string } | null };
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
      result.firstAdded ??= { id, name: row.name };
      if (row.photoUrl) photos.push({ id, url: row.photoUrl });
    } catch (e) {
      // The unique index: another import added them a moment ago.
      if (errorCode(e) === "23505") result.skipped++;
      else {
        logEvent("people.import_row_failed", errorFields(e));
        result.failed++;
      }
    }
  }
  await inBatches(photos, size.concurrency, async ({ id, url }) => {
    if (!(await copyPhoto(store, deps, userId, id, url, size))) result.photosMissed++;
  });
  return result;
}
