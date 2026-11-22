// Keeping contact details out of what goes to an AI (T42, ALL-134). The patterns below describe
// what an email, phone or address looks like: true constants (T23), not business values.

/** What stripContactDetails puts in place of an email, phone number or address. */
export const CONTACT_REMOVED = "[contact removed]";

/** "apt" -> "[Aa][Pp][Tt]": case-insensitive for one word inside a case-sensitive pattern. */
const ci = (word: string) => [...word].map((c) => (/\p{L}/u.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c)).join("");

const EMAIL = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

// ─── street addresses ──
// Short suffixes and "street" match in any case; the long words that also turn up in normal
// sentences ("a 3 hour drive", "road trip", "the long way") only when capitalised.
const SUFFIX_ANY_CASE = ["street", "st", "ave", "rd", "blvd", "ln", "ct", "pl"].map(ci).join("|");
const SUFFIX_CAPITALISED = "Avenue|Road|Boulevard|Drive|Dr|Lane|Court|Way|Place|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Square|Sq";
const UNIT_WORD = ["apartment", "apt", "unit", "suite", "ste", "flat", "floor", "fl", "room", "rm"].map(ci).join("|");
const SP = "[ \\t]";
const STREET_WORD = String.raw`(?:\p{L}[\p{L}'-]*\.?|\d+(?:st|nd|rd|th))`;
const UNIT = String.raw`(?:,?${SP}*(?:(?:${UNIT_WORD})\.?${SP}*#?|#)${SP}*[\p{L}\p{N}-]+)`;
// "Springfield, IL 62704" or "Springfield IL 62704-1234", only straight after a street.
const CITY_STATE_ZIP = String.raw`(?:,?${SP}+\p{Lu}[\p{L}.'-]*(?:${SP}+\p{Lu}[\p{L}.'-]*){0,2},?${SP}+[A-Z]{2}${SP}+\d{5}(?:-\d{4})?)`;
const STREET = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,$])\d{1,6}[A-Za-z]?${SP}+(?:${STREET_WORD}${SP}+){1,3}(?:${SUFFIX_ANY_CASE}|${SUFFIX_CAPITALISED})(?![\p{L}\p{N}])\.?${UNIT}?${CITY_STATE_ZIP}?`,
  "gu",
);
// A unit on its own: "Flat 3", "apt 4b". A number is required, and a bare "#1" isn't a unit.
const UNIT_ALONE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${UNIT_WORD})\.?${SP}*#?${SP}*\d+[A-Za-z]?(?![\p{L}\p{N}])`, "gu");
const PO_BOX = /(?<![\p{L}\p{N}])P\.?[ \t]?O\.?[ \t]+Box[ \t]+\d+(?![\p{L}\p{N}])/giu;

// ─── phone numbers ──
// Digit groups split by a space, dot or dash, or wrapped in parentheses, with an optional
// +country code and extension. looksLikePhone then decides; a match it turns down is left as it is.
// A $ , . / # or - before it means a price, date or range, so a match never starts there.
const PHONE_GROUP = String.raw`(?:\(\d{1,5}\)|\d{1,11})`;
const EXTENSION = String.raw`(?:${SP}*(?:x|${ci("ext")}\.?|${ci("extension")})${SP}*\d{1,6})`;
const PHONE = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,$/#+-])(?:\+\d{1,3}[ \t.-]?)?${PHONE_GROUP}(?:[ \t.-]?${PHONE_GROUP}){0,6}${EXTENSION}?(?![\p{L}\p{N}])`,
  "gu",
);

function looksLikePhone(match: string): boolean {
  const number = match.replace(new RegExp(`${EXTENSION}$`, "u"), "");
  const plus = number.startsWith("+");
  const groups = number.match(/\d+/g) ?? [];
  const digits = groups.join("").length;
  if (digits < 10 || digits > 15) return false;
  // A phone ends in a group of 3 or more ("UPC 0 12345 67890 5", "ISBN ...-7" don't), except a
  // +country number such as France's "+33 1 23 45 67 89".
  if (!plus && groups[groups.length - 1].length < 3) return false;
  // Years and SKUs come in 4-digit runs; a phone has at most two such groups.
  if (groups.filter((g) => g.length === 4).length > 2) return false;
  // Ages and jersey numbers are runs of short groups; only a +country number is written like that.
  if (!plus) {
    let run = 0;
    for (const g of groups) {
      run = g.length <= 2 ? run + 1 : 0;
      if (run >= 3) return false;
    }
  }
  // Without a + or parentheses, one or two groups must be a plain 10- or 11-digit number.
  if (!plus && !number.includes("(") && groups.length <= 2 && digits > 11) return false;
  return true;
}

/**
 * Replaces emails, phone numbers, street addresses, flat or unit numbers and PO boxes with
 * CONTACT_REMOVED before text goes to an AI (T42, ALL-134). Only what's sent is filtered; saved
 * facts and what the buyer sees are unchanged.
 *
 * **It prefers stripping over missing (T42).** A house number followed by up to three words and a
 * street suffix is an address, in any case for the short suffixes ("12 elm st"), so a fact such as
 * "bought 2 Main St signs" loses its middle: an accepted trade-off. Long suffix words that are also
 * everyday words (drive, road, way, court, place) count only when capitalised, so "a 3 hour drive"
 * stays. A phone needs 10 to 15 digits with at most two 4-digit groups and, unless it starts with
 * +, a last group of 3 or more digits and no run of three 1-2 digit groups; a bare 10-11 digit
 * number and an extension ("x12", "ext 12") count too. So lists of years, ages and jersey numbers,
 * ISBNs, UPCs and SKUs stay, and so do prices, dates and sizes.
 */
export function stripContactDetails(text: string): string {
  return text
    .replace(EMAIL, CONTACT_REMOVED)
    .replace(STREET, CONTACT_REMOVED)
    .replace(PO_BOX, CONTACT_REMOVED)
    .replace(UNIT_ALONE, CONTACT_REMOVED)
    .replace(PHONE, (m) => (looksLikePhone(m) ? CONTACT_REMOVED : m));
}
