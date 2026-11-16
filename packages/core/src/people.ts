// Relationships and the occasions they imply (ALL-21). Pure rules: the
// database stores the result, this decides it.

import { type CalendarDate } from "./dates";
import { nextOccurrence, type OccasionKind, type OccasionRule } from "./occasions";

export const RELATIONSHIPS = [
  // Alphabetical by label, so a long list is easy to scan; Other stays last.
  "aunt",
  "best_friend",
  "boyfriend",
  "brother",
  "brother_in_law",
  "daughter",
  "daughter_in_law",
  "father",
  "father_in_law",
  "friend",
  "girlfriend",
  "grandfather",
  "grandmother",
  "husband",
  "mother",
  "mother_in_law",
  "partner",
  "sister",
  "sister_in_law",
  "son",
  "son_in_law",
  "uncle",
  "wife",
  "other",
] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

/** A readable name; a stored value we don't know (say, from an older build) reads "Other". */
export function relationshipLabel(r: string): string {
  if (!(RELATIONSHIPS as readonly string[]).includes(r)) return "Other";
  // "mother_in_law" reads "Mother-in-law", "best_friend" reads "Best friend".
  const words = r.endsWith("_in_law") ? r.replaceAll("_", "-") : r.replace("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The occasions a new person starts with, given the dates the user entered. */
export function startingOccasions(
  r: Relationship,
  o: { birthday: boolean; anniversary: boolean },
): OccasionKind[] {
  const kinds: OccasionKind[] = ["christmas"];
  if (o.birthday) kinds.push("birthday");
  if (r === "mother" || r === "grandmother" || r === "mother_in_law") kinds.push("mothers_day");
  if (r === "father" || r === "grandfather" || r === "father_in_law") kinds.push("fathers_day");
  if (["wife", "husband", "girlfriend", "boyfriend", "partner"].includes(r)) kinds.push("valentines_day");
  if ((r === "wife" || r === "husband") && o.anniversary) kinds.push("anniversary");
  return kinds;
}

function ruleFor(o: { kind: OccasionKind; month: number | null; day: number | null }): OccasionRule {
  if (o.kind === "birthday" || o.kind === "anniversary") {
    if (o.month === null || o.day === null) throw new Error(`A ${o.kind} needs a month and day`);
    return { kind: o.kind, month: o.month, day: o.day };
  }
  return { kind: o.kind };
}

/** The soonest enabled occasion on or after `today`; ties go to list order. */
export function nextOccasion(
  occasions: { kind: OccasionKind; month: number | null; day: number | null; enabled: boolean }[],
  today: CalendarDate,
): { kind: OccasionKind; date: CalendarDate } | null {
  let best: { kind: OccasionKind; date: CalendarDate } | null = null;
  for (const o of occasions) {
    if (!o.enabled) continue;
    const date = nextOccurrence(ruleFor(o), today);
    if (best === null || date < best.date) best = { kind: o.kind, date };
  }
  return best;
}
