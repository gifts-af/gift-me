// A US shipping address and its format check (ALL-81, T51). The person page's
// form, the people service and the round engine all use this one check, so
// "complete" means the same everywhere. Format only: nothing here (or anywhere)
// sends an address out to be checked (T42).

/** An input-size guard, not a tunable. */
export const ADDRESS_FIELD_MAX = 200;

/** The 50 states and DC, A–Z by name: a true constant (T23). */
export const US_STATES: readonly { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const STATE_CODES = new Set(US_STATES.map((s) => s.code));

export type AddressField = "firstName" | "lastName" | "line1" | "line2" | "city" | "state" | "zip";
export type AddressDraft = Partial<Record<AddressField, string | null>>;
export type Address = {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
};

const MISSING: Record<Exclude<AddressField, "line2">, string> = {
  firstName: "Add their first name.",
  lastName: "Add their last name.",
  line1: "Add a street address.",
  city: "Add a city.",
  state: "Pick a state.",
  zip: "Enter a 5-digit ZIP code.",
};
const TOO_LONG = "Keep this under 200 characters.";

function zipOf(s: string): string | null {
  if (/^\d{5}(-\d{4})?$/.test(s)) return s;
  if (/^\d{9}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5)}`;
  return null;
}

/** The address, trimmed and normalized, or a plain message for each bad field. */
export function checkAddress(
  d: AddressDraft,
): { ok: true; value: Address } | { ok: false; errors: Partial<Record<AddressField, string>> } {
  const t = (k: AddressField) => (d[k] ?? "").trim();
  const errors: Partial<Record<AddressField, string>> = {};

  for (const k of Object.keys(MISSING) as (keyof typeof MISSING)[]) {
    if (t(k) === "") errors[k] = MISSING[k];
  }
  if (t("line2").length > ADDRESS_FIELD_MAX) errors.line2 = TOO_LONG;
  for (const k of ["firstName", "lastName", "line1", "city"] as const) {
    if (t(k).length > ADDRESS_FIELD_MAX) errors[k] = TOO_LONG;
  }
  if (t("state") !== "" && !STATE_CODES.has(t("state"))) errors.state = MISSING.state;
  const zip = zipOf(t("zip"));
  if (t("zip") !== "" && zip === null) errors.zip = MISSING.zip;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      firstName: t("firstName"),
      lastName: t("lastName"),
      line1: t("line1"),
      line2: t("line2") || null,
      city: t("city"),
      state: t("state"),
      zip: zip!,
    },
  };
}

/** Ready to ship to: a US address that passes the check. */
export function isShippableAddress(d: AddressDraft & { country?: string | null }): boolean {
  return d.country === "US" && checkAddress(d).ok;
}

/** A starting point for the recipient's names: the last word is the last name. */
export function splitRecipientName(name: string): { firstName: string; lastName: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { firstName: words[0] ?? "", lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}
