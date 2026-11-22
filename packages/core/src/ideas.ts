// Pure rules for choosing and keeping gift ideas (ALL-27). No I/O: the Zinc
// shapes are already translated by the adapter, and every number (budget,
// tax, fee, timeouts, limits) arrives as an argument (T23).

import { classifyTotal, estimatedTotalCents } from "./budget";
import { compareDates, type CalendarDate } from "./dates";
import { arriveBy, canArriveInTime, orderBy, type ScheduleSettings } from "./schedule";

/** A search hit. The brand is matched against the title. `imageUrl`: Zinc's photo, https only, when the hit has one. */
export type ZincHit = { productId: string; title: string; priceCents: number | null; imageUrl?: string };

export type ZincOffer = {
  offerId: string | null;
  priceCents: number;
  shippingCents: number;
  available: boolean;
  condition: string;
  buyBox: boolean;
  firstParty: boolean;
  sellerName: string | null;
  handlingDaysMax: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
};

export type DropReason =
  | "not_found"
  | "unavailable"
  | "late"
  | "over_limit"
  | "given_or_rejected"
  | "sensitive"
  | "names"
  | "vendor_error"
  | "duplicate";

/** The first hit whose title contains the brand (any case); with no brand, the first hit. */
export function matchHit(hits: ZincHit[], brand: string | null): ZincHit | null {
  if (brand === null) return hits[0] ?? null;
  const wanted = brand.toLowerCase();
  return hits.find((h) => h.title.toLowerCase().includes(wanted)) ?? null;
}

/** Available, new offers only; buy box first, then first party, then the fastest delivery. */
export function pickOffer(offers: ZincOffer[]): ZincOffer | null {
  const usable = offers.filter((o) => o.available && o.condition.trim().toLowerCase() === "new");
  const days = (o: ZincOffer) => o.handlingDaysMax + o.deliveryDaysMax;
  usable.sort(
    (a, b) => Number(b.buyBox) - Number(a.buyBox) || Number(b.firstParty) - Number(a.firstParty) || days(a) - days(b),
  );
  return usable[0] ?? null;
}

export type JudgeContext = {
  budgetCents: number | null;
  overBudgetPct: number;
  taxPct: number;
  feeCents: number;
  occasionDate: CalendarDate | null;
  orderDate: CalendarDate;
  excluded: ReadonlySet<string>;
  /** After a "Too pricey" rejection (ALL-29): a total at or above this drops as over_limit. */
  maxTotalCents: number | null;
};

export function judgeCandidate(
  c: { productId: string; offer: ZincOffer },
  ctx: JudgeContext,
  s: ScheduleSettings,
): { keep: true; totalCents: number; fit: "within" | "over"; arriveBy: CalendarDate | null } | { keep: false; reason: DropReason } {
  const { offer } = c;
  if (ctx.excluded.has(c.productId)) return { keep: false, reason: "given_or_rejected" };
  if (!offer.available) return { keep: false, reason: "unavailable" };
  if (
    ctx.occasionDate !== null &&
    !canArriveInTime(
      {
        occasionDate: ctx.occasionDate,
        orderDate: ctx.orderDate,
        handlingDaysMax: offer.handlingDaysMax,
        deliveryDaysMax: offer.deliveryDaysMax,
      },
      s,
    )
  ) {
    return { keep: false, reason: "late" };
  }
  const totalCents = estimatedTotalCents({
    priceCents: offer.priceCents,
    shippingCents: offer.shippingCents,
    taxCents: Math.round((offer.priceCents * ctx.taxPct) / 100),
    feeCents: ctx.feeCents,
  });
  if (ctx.maxTotalCents !== null && totalCents >= ctx.maxTotalCents) return { keep: false, reason: "over_limit" };
  const fit = classifyTotal(totalCents, ctx.budgetCents, ctx.overBudgetPct);
  if (fit === "dropped") return { keep: false, reason: "over_limit" };
  return {
    keep: true,
    totalCents,
    fit,
    arriveBy: ctx.occasionDate === null ? null : arriveBy(ctx.orderDate, offer.handlingDaysMax, offer.deliveryDaysMax),
  };
}

/** From a ranked list: up to `keepMax` within budget, plus the first over budget. Order kept. */
export function keepIdeas<T extends { fit: "within" | "over" }>(ranked: T[], keepMax: number): T[] {
  let within = 0;
  let over = false;
  return ranked.filter((r) => {
    if (r.fit === "within") return within++ < keepMax;
    if (over) return false;
    over = true;
    return true;
  });
}

function nameRegex(names: string[]): RegExp | null {
  const usable = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (usable.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

/** Replaces whole-word names (any case) with "them". Names under 2 letters are ignored. */
export function redactNames(text: string, names: string[]): string {
  const re = nameRegex(names);
  return re ? text.replace(re, "them") : text;
}

export function mentionsName(text: string, names: string[]): boolean {
  const re = nameRegex(names);
  return re ? re.test(text) : false;
}

/** The budget an idea run uses: the occasion's own, else the person's base, else the account default (T73). */
export function appliedBudget(own: number | null, base: number | null, byDefault: number | null): number | null {
  return own ?? base ?? byDefault;
}

/** The soonest occasion an order placed today can still reach, else null. */
export function onDemandOccasion(
  occasions: { date: CalendarDate; ownBudgetCents: number | null }[],
  today: CalendarDate,
  s: ScheduleSettings,
): { date: CalendarDate; ownBudgetCents: number | null } | null {
  const reachable = occasions.filter((o) => orderBy(o.date, today, s) !== null);
  reachable.sort((a, b) => compareDates(a.date, b.date));
  return reachable[0] ?? null;
}

/** A true constant: rates are per second. */
const SECOND_MS = 1000;

/**
 * Longest a run can take. The brainstorm: AI and Zinc each get one retry, and its lookups run in
 * parallel. The list pass (ALL-29): its lookups start at the rate limit, plus two Zinc timeouts
 * for the last gift, whose details lookup Zinc may reject before its store check runs. The photo
 * calls run in parallel after that: one more Zinc timeout.
 */
export function ideaRunWorstMs(
  aiTimeoutMs: number,
  zincTimeoutMs: number,
  listLookupsMax: number,
  zincRequestsPerSecond: number,
): number {
  const listPassMs = Math.ceil((listLookupsMax * SECOND_MS) / zincRequestsPerSecond) + 2 * zincTimeoutMs;
  return 2 * aiTimeoutMs + 2 * zincTimeoutMs + listPassMs + zincTimeoutMs;
}

/** True when another ranking call's worst-case cost still fits under the run's cap. */
export function canAffordRank(spentCents: number, rankWorstCents: number, maxCents: number): boolean {
  return spentCents + rankWorstCents <= maxCents;
}
