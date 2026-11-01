// Google Contacts import (ALL-24): turns Google People API contacts into the
// rows the "Who do you buy gifts for?" checklist shows. Runs in the browser,
// so contacts the buyer doesn't tick never reach our server (T42).
import { toDate } from "./dates";
import type { Relationship } from "./people";

export type ContactAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Two-letter code, or null when Google doesn't say (the database defaults to US). */
  country: string | null;
};

export type GoogleContact = {
  /** People API resource name, "people/c…". */
  googleId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  birthday: { month: number; day: number; year: number | null } | null;
  address: ContactAddress | null;
  /** A real photo; Google's default letter avatar is left out. */
  photoUrl: string | null;
};

// The People API fields we read. Everything is optional in Google's answer.
type Meta = { metadata?: { primary?: boolean } };
type ApiPerson = {
  resourceName?: string;
  names?: (Meta & { displayName?: string; givenName?: string; familyName?: string })[];
  nicknames?: (Meta & { value?: string })[];
  birthdays?: (Meta & { date?: { year?: number; month?: number; day?: number } })[];
  addresses?: (Meta & {
    streetAddress?: string;
    extendedAddress?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    countryCode?: string;
  })[];
  photos?: (Meta & { url?: string; default?: boolean })[];
};

// A leap year, so 29 February is a valid birthday.
const LEAP_YEAR = 2000;

const text = (s: string | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

/** The primary entry if Google marks one, otherwise the first that passes `ok`. */
function pick<T extends Meta>(items: T[] | undefined, ok: (item: T) => boolean = () => true): T | undefined {
  const usable = (items ?? []).filter(ok);
  return usable.find((i) => i.metadata?.primary) ?? usable[0];
}

function birthdayOf(p: ApiPerson): GoogleContact["birthday"] {
  const b = pick(p.birthdays, (b) => Boolean(b.date?.month && b.date?.day))?.date;
  if (!b?.month || !b.day) return null;
  try {
    toDate(LEAP_YEAR, b.month, b.day);
  } catch {
    return null;
  }
  return { month: b.month, day: b.day, year: b.year ?? null };
}

function addressOf(p: ApiPerson): ContactAddress | null {
  const a = pick(p.addresses, (a) => Boolean(text(a.streetAddress) || text(a.city)));
  if (!a) return null;
  // Google sometimes puts both street lines in streetAddress, one per line.
  const [street1, ...rest] = (a.streetAddress ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const line2 = text(a.extendedAddress) ?? (rest.length ? rest.join(", ") : null);
  const country = text(a.countryCode)?.toUpperCase() ?? null;
  return {
    line1: street1 ?? null,
    line2,
    city: text(a.city),
    state: text(a.region),
    zip: text(a.postalCode),
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

export function contactsFromPeopleApi(connections: unknown[]): GoogleContact[] {
  const rows: GoogleContact[] = [];
  for (const raw of connections) {
    const p = raw as ApiPerson;
    const nameEntry = pick(p.names, (n) => Boolean(text(n.displayName)));
    const name = text(nameEntry?.displayName);
    if (!name || !p.resourceName) continue;
    rows.push({
      googleId: p.resourceName,
      name,
      firstName: text(nameEntry?.givenName),
      lastName: text(nameEntry?.familyName),
      nickname: text(pick(p.nicknames, (n) => Boolean(text(n.value)))?.value),
      birthday: birthdayOf(p),
      address: addressOf(p),
      photoUrl: pick(p.photos, (ph) => Boolean(ph.url) && !ph.default)?.url ?? null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// What people call family in their contacts. Matched on the whole name or
// nickname, or its first word ("Mom cell", "Grandma Jo"), never inside a word.
const HINTS: [Relationship, string[]][] = [
  ["mother", ["mom", "mum", "mommy", "mummy", "mama", "mother", "ma"]],
  ["father", ["dad", "daddy", "father", "pops"]],
  ["grandmother", ["grandma", "grandmother", "granny", "gran", "nana", "nan", "grammy", "meemaw"]],
  ["grandfather", ["grandpa", "grandfather", "granddad", "grandad", "gramps", "poppy"]],
  ["wife", ["wife", "wifey"]],
  ["husband", ["husband", "hubby"]],
];

function firstWord(s: string): string {
  return s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)[0] ?? "";
}

/** "Mom" → mother, "Grandma Jo" → grandmother; null when the name gives no hint. */
export function guessRelationship(name: string, nickname: string | null): Relationship | null {
  for (const candidate of [nickname, name]) {
    if (!candidate) continue;
    const word = firstWord(candidate);
    const hit = HINTS.find(([, words]) => words.includes(word));
    if (hit) return hit[0];
  }
  return null;
}

/** Only https on Google's photo host; the server fetches nothing else (ALL-24). */
export function isGooglePhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

/** Google serves its photos at any size given by a trailing "=s<px>". */
export function sizedGooglePhotoUrl(url: string, px: number): string {
  return `${url.replace(/=s\d+(-[a-z0-9-]+)?$/i, "")}=s${px}`;
}
