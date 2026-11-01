// Pure parsing rules for the people screens (ALL-21): no database, no UI.
//
// FormData fields read by parsePersonForm (an empty string means "not given"):
//   name, relationship, birthdayMonth, birthdayDay, birthYear,
//   anniversaryMonth, anniversaryDay
import { RELATIONSHIPS, toDate, type Relationship } from "@gifts-af/core";

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
