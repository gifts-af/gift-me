// Pure parsing rules for the people screens (ALL-21): no database, no UI.
//
// FormData fields read by parsePersonForm (an empty string means "not given"):
//   name, relationship, birthdayMonth, birthdayDay, birthYear,
//   anniversaryMonth, anniversaryDay
import {
  ADDRESS_FIELD_MAX,
  checkAddress,
  isGooglePhotoUrl,
  RELATIONSHIPS,
  toDate,
  type Address,
  type AddressField,
  type Relationship,
} from "@gifts-af/core";

export type MonthDay = { month: number; day: number };

export type PersonInput = {
  name: string;
  relationship: Relationship;
  birthday: MonthDay | null;
  birthYear: number | null;
  anniversary: MonthDay | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const BAD_DATE = "That date doesn't exist.";
const BAD_BIRTH_YEAR = "Enter a birth year between 1900 and this year.";
const MIN_BIRTH_YEAR = 1900;
const MAX_NAME_LENGTH = 120;
// A leap year, so 29 February is a valid birthday or anniversary.
const LEAP_YEAR = 2000;

function field(f: FormData, key: string): string {
  const v = f.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function wholeNumber(s: string): number | null {
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
}

// Both parts empty: not given. Only one, or an impossible date: an error.
function parseMonthDay(month: string, day: string): Result<MonthDay | null> {
  if (month === "" && day === "") return { ok: true, value: null };
  const m = wholeNumber(month);
  const d = wholeNumber(day);
  if (m === null || d === null) return { ok: false, error: BAD_DATE };
  try {
    toDate(LEAP_YEAR, m, d);
  } catch {
    return { ok: false, error: BAD_DATE };
  }
  return { ok: true, value: { month: m, day: d } };
}

export function parsePersonForm(
  f: FormData,
  currentYear: number = new Date().getFullYear(),
  options: { anyAnniversary?: boolean } = {},
): Result<PersonInput> {
  const name = field(f, "name");
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return { ok: false, error: "Enter a name." };

  const relationship = RELATIONSHIPS.find((r) => r === field(f, "relationship"));
  if (!relationship) return { ok: false, error: "Pick a relationship." };

  const birthday = parseMonthDay(field(f, "birthdayMonth"), field(f, "birthdayDay"));
  if (!birthday.ok) return birthday;

  let birthYear: number | null = null;
  const yearText = field(f, "birthYear");
  if (yearText !== "") {
    birthYear = wholeNumber(yearText);
    if (birthYear === null || birthYear < MIN_BIRTH_YEAR || birthYear > currentYear) {
      return { ok: false, error: BAD_BIRTH_YEAR };
    }
  }

  // Validated for everyone. Kept only for a wife or husband when adding; when
  // editing (anyAnniversary) it is kept for anyone, so changing a relationship
  // never drops an anniversary.
  const anniversary = parseMonthDay(field(f, "anniversaryMonth"), field(f, "anniversaryDay"));
  if (!anniversary.ok) return anniversary;
  const keepAnniversary = options.anyAnniversary || relationship === "wife" || relationship === "husband";

  return {
    ok: true,
    value: {
      name,
      relationship,
      birthday: birthday.value,
      birthYear,
      anniversary: keepAnniversary ? anniversary.value : null,
    },
  };
}

// A budget in whole dollars or dollars and cents, stored as cents.
export function parseBudget(
  input: string,
): { ok: true; cents: number | null } | { ok: false; error: string } {
  const text = input.trim().replace(/^\$/, "");
  if (input.trim() === "") return { ok: true, cents: null };
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return { ok: false, error: "Enter an amount like 75 or 75.50." };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "Enter an amount like 75 or 75.50." };
  return { ok: true, cents };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BARE_UUID = new RegExp(`^${UUID}$`, "i");
/** True for a UUID; anything else can never be a stored id (and would make Postgres error). */
export function isUuid(id: string): boolean {
  return BARE_UUID.test(id);
}

const SHARE_PATH = new RegExp(`^/share/(${UUID})/?$`, "i");

// The UUID (lower case) from a share link on any host, or a bare UUID.
export function parseShareToken(input: string): string | null {
  const text = input.trim();
  if (BARE_UUID.test(text)) return text.toLowerCase();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const m = SHARE_PATH.exec(url.pathname);
  return m ? m[1].toLowerCase() : null;
}

// ─── Google Contacts import (ALL-24) ───────────────────────────────────────

export type ImportAddress = {
  firstName: string | null;
  lastName: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
};

/** A ticked contact, checked and ready to save. */
export type ImportRow = {
  googleId: string;
  name: string;
  relationship: Relationship;
  birthday: MonthDay | null;
  birthYear: number | null;
  address: ImportAddress | null;
  photoUrl: string | null;
};

// Input-size guards, like MAX_NAME_LENGTH: not tunables.
const MAX_IMPORT_ROWS = 1000;
const GOOGLE_ID = /^people\/c\d{1,30}$/;
const NOTHING_TO_IMPORT = "Nothing to import. Try again.";

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function importAddress(v: unknown): ImportAddress | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) return undefined;
  const keys = ["firstName", "lastName", "line1", "line2", "city", "state", "zip", "country"] as const;
  const out = {} as ImportAddress;
  for (const k of keys) {
    const s = str(v[k]);
    if (s !== null && s.length > ADDRESS_FIELD_MAX) return undefined;
    out[k] = s;
  }
  if (out.country !== null && !/^[A-Z]{2}$/.test(out.country)) out.country = null;
  return out;
}

/** One row, or null when anything in it is wrong. */
function importRow(v: unknown, currentYear: number): ImportRow | null {
  if (!isObject(v)) return null;
  const googleId = str(v.googleId);
  const name = str(v.name);
  const relationship = RELATIONSHIPS.find((r) => r === v.relationship);
  if (!googleId || !GOOGLE_ID.test(googleId) || !name || name.length > MAX_NAME_LENGTH || !relationship) return null;

  let birthday: MonthDay | null = null;
  let birthYear: number | null = null;
  if (v.birthday !== null && v.birthday !== undefined) {
    if (!isObject(v.birthday)) return null;
    const { month, day, year } = v.birthday;
    try {
      toDate(LEAP_YEAR, month as number, day as number);
    } catch {
      return null;
    }
    birthday = { month: month as number, day: day as number };
    // A year we can't believe is dropped, not the birthday.
    if (Number.isInteger(year) && (year as number) >= MIN_BIRTH_YEAR && (year as number) <= currentYear) {
      birthYear = year as number;
    }
  }

  const address = importAddress(v.address);
  if (address === undefined) return null;

  const photoUrl = str(v.photoUrl);
  if (photoUrl !== null && !isGooglePhotoUrl(photoUrl)) return null;

  return { googleId, name, relationship, birthday, birthYear, address, photoUrl };
}

/** The checklist's ticked rows, sent as JSON. Bad rows are counted, not fatal (AC-10). */
export function parseImportRows(
  json: string,
  currentYear: number = new Date().getFullYear(),
): { ok: true; rows: ImportRow[]; refused: number } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: NOTHING_TO_IMPORT };
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: NOTHING_TO_IMPORT };
  }
  const rows = new Map<string, ImportRow>();
  let refused = 0;
  for (const v of data) {
    const row = importRow(v, currentYear);
    if (!row) refused++;
    else if (!rows.has(row.googleId)) rows.set(row.googleId, row);
  }
  return { ok: true, rows: [...rows.values()], refused };
}

// ─── A person's shipping address (ALL-81) ────────────────────────────────────

/** What the address form's action returns: per-field messages on a bad address. */
export type AddressSaveResult =
  | { ok: true }
  | { ok: false; error: string; fields?: Partial<Record<AddressField, string>> };

const ADDRESS_FIELDS: AddressField[] = ["firstName", "lastName", "line1", "line2", "city", "state", "zip"];

/** The address form (fields named as AddressField), checked by the shared format check (T51). */
export function parseAddressForm(
  f: FormData,
): { ok: true; value: Address } | { ok: false; error: "Check the address below."; fields: Partial<Record<AddressField, string>> } {
  const checked = checkAddress(Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, field(f, k)])));
  return checked.ok ? checked : { ok: false, error: "Check the address below.", fields: checked.errors };
}
