// Pure rules for the approval screen: the picks bar, what a rejection teaches
// the profile, and the next-best idea to offer instead (ALL-29). No I/O.
import { classifyTotal, type BudgetFit } from "./budget";
import type { CalendarDate } from "./dates";
import { canArriveInTime, type ScheduleSettings } from "./schedule";

export type RejectionCode = "has_it" | "not_style" | "too_pricey" | "too_generic";

/** Mirrors the profile_facts check (value is at most 500 characters). */
export const FACT_VALUE_MAX = 500;

type IdeaRef = { title: string; source: "generated" | "list" };
export type RejectionFact = { category: "owns" | "avoid"; value: string };

// Same as profile_facts.value_key: lower(regexp_replace(btrim(value), '\s+', ' ', 'g')).
const factKey = (f: RejectionFact) => `${f.category}\u0000${f.value.trim().replace(/\s+/g, " ").toLowerCase()}`;

/** The number of characters as the database counts them: code points, so an emoji is one. */
const chars = (s: string) => Array.from(s).length;

/** The first n characters as the database counts them, never splitting an emoji in two. */
function cut(s: string, n: number): string {
  const all = Array.from(s);
  return all.length > n ? all.slice(0, n).join("") : s;
}

function listFact(prefix: string, titles: string[]): string {
  let value = prefix;
  let sep = ": ";
  for (const title of titles) {
    const next = value + sep + title;
    if (chars(next) > FACT_VALUE_MAX) {
      // Even the first title doesn't fit: cut it rather than lose the fact.
      if (sep === ": ") value = cut(next, FACT_VALUE_MAX);
      break;
    }
    value = next;
    sep = ", ";
  }
  return value;
}

/** What a rejection saves to the person's profile. List gift titles are never saved (T42). */
export function rejectionFacts(
  code: RejectionCode,
  text: string | null,
  ideas: IdeaRef[],
  owned: IdeaRef | null,
): RejectionFact[] {
  const facts: RejectionFact[] = [];
  const ownedTitle = owned?.source === "generated" ? owned.title.trim() : "";
  if (code === "has_it" && ownedTitle) {
    facts.push({ category: "owns", value: cut(ownedTitle, FACT_VALUE_MAX) });
  }
  if (code === "not_style" || code === "too_generic") {
    const titles = ideas.filter((i) => i.source === "generated").map((i) => i.title);
    // With no AI titles, a bare "Not their style" teaches the AI nothing (and would count as a fact for a new run).
    if (titles.length > 0) {
      facts.push({
        category: "avoid",
        value: listFact(code === "not_style" ? "Not their style" : "Too generic", titles),
      });
    }
  }
  const reason = cut(text?.trim() ?? "", FACT_VALUE_MAX).trim();
  if (reason) facts.push({ category: "avoid", value: reason });

  // The database refuses two facts with the same category and value key (error 21000).
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = factKey(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The lowest-ranked proposed idea that can still arrive in time, or null. */
export function nextBestIdea(
  ideas: { id: string; rank: number; status: string; handlingDaysMax: number; deliveryDaysMax: number }[],
  ctx: { today: CalendarDate; occasionDate: CalendarDate; s: ScheduleSettings },
): string | null {
  const fits = ideas
    .filter(
      (i) =>
        i.status === "proposed" &&
        canArriveInTime(
          {
            occasionDate: ctx.occasionDate,
            orderDate: ctx.today,
            handlingDaysMax: i.handlingDaysMax,
            deliveryDaysMax: i.deliveryDaysMax,
          },
          ctx.s,
        ),
    )
    .sort((a, b) => a.rank - b.rank);
  return fits[0]?.id ?? null;
}

/** The count, total and budget fit of the ideas picked so far. */
export function picksBar(
  totals: number[],
  budgetCents: number | null,
  overBudgetPct: number,
): { count: number; totalCents: number; fit: BudgetFit } {
  const totalCents = totals.reduce((a, b) => a + b, 0);
  return { count: totals.length, totalCents, fit: classifyTotal(totalCents, budgetCents, overBudgetPct) };
}
