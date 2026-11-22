import {
  appliedBudget,
  canAffordRank,
  judgeCandidate,
  keepIdeas,
  matchHit,
  mentionsName,
  nextOccurrence,
  onDemandOccasion,
  pickOffer,
  redactNames,
  stripContactDetails,
  relationshipLabel,
  type CalendarDate,
  type DropReason,
  type JudgeContext,
  type ScheduleSettings,
  type ZincHit,
  type ZincOffer,
} from "@gifts-af/core";
import { brainstorm, rank, rankInputTokensMax, rankWorstCents, type IdeaCandidate } from "@/lib/ai/ideas";
import { AiError, gatewayPrices, type GatewayHttp } from "@/lib/ai/messages";
import { AI_MODELS } from "@/lib/ai/models";
import { isSensitive } from "@/lib/ai/sensitive";
import { errorFields, logEvent } from "@/lib/log";
import { storeName } from "@gifts-af/core/store-page/link";
import { ZincError, type ZincErrorKind, type ZincHttp } from "../zinc/client";
import {
  listGiftQuote,
  listGiftRoute,
  productDetails,
  productOffers,
  searchProducts,
  type ZincRetailer,
  type ZincStep,
} from "../zinc/products";
import type { IdeaInputs, IdeaRefusal, IdeaSettings, IdeaStore, ListGift, RunEnd, SavedIdea } from "./store";

// One idea run (ALL-27): the person's own list gifts first (ALL-29), then, with too few of
// them, brainstorm, look each candidate up on Zinc, judge it, rank, and save, each with Zinc's
// photo. Every number is a setting and every client arrives in
// `deps` (E3, T23). Money is capped as it goes (AC-29): the AI's cost from the
// Gateway's figures, and each Zinc call at zinc_lookup_cents. Events carry ids,
// counts, cents and stage names only (E6, T42).

export type IdeaRequest = { userId: string; personId: string; roundId: string | null; signal: AbortSignal };

export type IdeaOutcome =
  | { status: "saved"; count: number }
  | { status: "none" }
  | { status: "no_facts" }
  | { status: "off" }
  | { status: "refused"; reason: IdeaRefusal }
  | { status: "failed" }
  | { status: "cost_cap" }
  | { status: "deadline" };

export type IdeaDeps = {
  store: IdeaStore;
  gateway: GatewayHttp;
  zinc: { http: ZincHttp; key: string };
  today: CalendarDate;
  /** Milliseconds; Date.now in production. */
  clock: () => number;
  /** Waits for the Zinc rate limit; a timer in production. */
  sleep: (ms: number) => Promise<void>;
  /** How many runs share Zinc's request rate at once (ALL-125); this run gets 1/share of it. Default 1. */
  zincShare?: number;
};

/** A true constant: the rate limit is per second. */
const SECOND_MS = 1000;
const AMAZON = "amazon";

/** What the closing `ideas.run` event reports. */
type Tally = {
  runId: string | null;
  stage: "checks" | "started" | "brainstormed" | "resolved" | "ranked";
  spent: number;
  /** List gifts that qualified (ALL-29). */
  listKept: number;
  candidates: number;
  resolved: number;
  kept: number;
  keepMin: number | null;
  refusal: IdeaRefusal | null;
  error: { name: string; kind: string | null } | null;
  /** An AI call was cut off (timeout or the tick's deadline), so what it used was never reported. */
  costUnknown: boolean;
};

type Found = { c: IdeaCandidate; hit: ZincHit; offer: ZincOffer; totalCents: number; fit: "within" | "over"; arriveBy: CalendarDate | null };
type Resolved = { found: Found } | { drop: DropReason; kind?: ZincErrorKind } | { stopped: true };

/** Whole cents, rounded up, after dropping float noise below a thousandth of a cent. */
const cents = (x: number) => Math.ceil(Math.round(x * 1000) / 1000);

export async function runIdeas(req: IdeaRequest, deps: IdeaDeps): Promise<IdeaOutcome> {
  const startedMs = deps.clock();
  const t: Tally = {
    runId: null,
    stage: "checks",
    spent: 0,
    listKept: 0,
    candidates: 0,
    resolved: 0,
    kept: 0,
    keepMin: null,
    refusal: null,
    error: null,
    costUnknown: false,
  };
  let outcome: IdeaOutcome = { status: "failed" };
  try {
    outcome = await attempt(req, deps, t);
  } catch (e) {
    // An AI reply we paid for but couldn't read still counts toward the cap.
    if (e instanceof AiError && e.costCents) t.spent += e.costCents;
    const f = errorFields(e);
    t.error = { name: String(f.name), kind: typeof f.kind === "string" ? f.kind : null };
    outcome = { status: req.signal.aborted ? "deadline" : "failed" };
    if (t.runId !== null) await deps.store.finish(t.runId, outcome.status as RunEnd, cents(t.spent));
  } finally {
    logEvent("ideas.run", {
      ...ids(req, t.runId),
      list_kept: t.listKept,
      candidates: t.candidates,
      resolved: t.resolved,
      kept: t.kept,
      short: t.keepMin !== null && t.kept < t.keepMin,
      stage: t.stage,
      outcome: outcome.status,
      refusal: t.refusal,
      cost_cents: cents(t.spent),
      ms: deps.clock() - startedMs,
      ...(t.error ? { error: t.error.name, error_kind: t.error.kind } : {}),
      ...(t.costUnknown ? { costUnknown: true } : {}),
    });
  }
  return outcome;
}

function ids(req: IdeaRequest, runId: string | null) {
  return { run_id: runId, user_id: req.userId, person_id: req.personId, round_id: req.roundId };
}

async function attempt(req: IdeaRequest, deps: IdeaDeps, t: Tally): Promise<IdeaOutcome> {
  const { store } = deps;
  const refuse = (reason: IdeaRefusal): IdeaOutcome => {
    t.refusal = reason;
    return { status: "refused", reason };
  };

  // Nothing above `start` spends money or counts a run (AC-13, AC-15, AC-17).
  const s = await store.settings();
  if (!s.enabled) return { status: "off" };
  if (!(await store.hasPaidFeatures(req.userId))) return refuse("not_paid");
  const inputs = await store.inputs(req);
  if (inputs === null) return refuse("not_found");
  // A person with no facts can still have gifts on their own list (AC-28).
  if (inputs.facts.length === 0 && inputs.listGifts.length === 0) return { status: "no_facts" };
  const plan = occasionPlan(inputs, deps.today, s.schedule);

  const started = await store.start(req, new Date(deps.clock()));
  if ("refused" in started) return refuse(started.refused);
  const runId = started.runId;
  t.runId = runId;
  t.stage = "started";
  t.keepMin = s.keepMin;
  logEvent("ideas.run_started", ids(req, runId));

  const end = async (outcome: RunEnd): Promise<IdeaOutcome> => {
    await store.finish(runId, outcome, cents(t.spent));
    return { status: outcome } as IdeaOutcome;
  };
  const dropped = (reason: DropReason, kind?: ZincErrorKind) =>
    logEvent("ideas.candidate_dropped", { run_id: runId, reason, ...(kind ? { kind } : {}) });

  // ─── every Zinc call, capped by cost and rate ──
  const limit = limiter(s.zincRequestsPerSecond / (deps.zincShare ?? 1), deps.clock, deps.sleep);
  let capped = false;
  // Set when a lookup fails with an error that ends the run: no new paid call starts after it.
  let stopping = false;
  /** `still`: checked again after the rate limit's wait, so a call that's no longer needed isn't paid for. */
  const lookup = async <T>(call: () => Promise<T>, still: () => boolean = () => true): Promise<T | "stop"> => {
    if (capped || stopping || req.signal.aborted) return "stop";
    await limit();
    if (stopping || req.signal.aborted || !still()) return "stop";
    if (t.spent + s.zincLookupCents > s.runMaxCents) {
      capped = true;
      return "stop";
    }
    t.spent += s.zincLookupCents;
    return call();
  };
  const ctx: JudgeContext = {
    budgetCents: plan.budgetCents,
    overBudgetPct: inputs.overBudgetPct,
    taxPct: s.taxPct,
    feeCents: s.orderFeeCents,
    occasionDate: plan.occasionDate,
    orderDate: plan.orderDate,
    excluded: new Set(inputs.excluded),
    maxTotalCents: inputs.round?.maxTotalCents ?? null,
  };

  // ─── the person's own list first (AC-27) ──
  const halt = () => {
    stopping = true;
  };
  const listed = await listPass(inputs.listGifts, { req, deps, s, ctx, runId, lookup, stopped: () => capped || stopping, halt });
  t.listKept = listed.length;

  // ─── the brainstorm, only with too few list gifts and some facts (AC-28) ──
  let generated: Kept[] = [];
  const brainstormNeeded = listed.length < s.listMin && inputs.facts.length > 0 && !capped && !req.signal.aborted;
  if (brainstormNeeded) {
    try {
      const r = await brainstormPass(inputs, plan, listed, { req, deps, s, ctx, runId, t, lookup, dropped, capped: () => capped, halt });
      // List gifts that qualified are saved even when the cap or the deadline stopped the brainstorm (B1).
      if ("end" in r && listed.length === 0) return end(r.end);
      if ("kept" in r) generated = r.kept;
    } catch (e) {
      if (listed.length === 0) throw e;
      // Keep the list gifts. The failure is still reported in ideas.run.
      if (e instanceof AiError && e.costCents) t.spent += e.costCents;
      const f = errorFields(e);
      t.error = { name: String(f.name), kind: typeof f.kind === "string" ? f.kind : null };
    }
  } else if (listed.length === 0) {
    if (req.signal.aborted) return end("deadline");
    if (capped) return end("cost_cap");
    return end("none");
  }

  // ─── photos, then save, list gifts ranked first (AC-17, AC-27) ──
  const kept = [...listed, ...generated];
  t.kept = kept.length;
  if (kept.length === 0) return end("none");
  const photo = async (retailer: ZincRetailer, productId: string): Promise<string | null> => {
    // Only while the run has room under its cap; a skipped or failed call leaves no photo and keeps the idea.
    if (t.spent + s.zincLookupCents > s.runMaxCents) return null;
    try {
      const d = await lookup(() => productDetails(deps.zinc.http, deps.zinc.key, retailer, productId, req.signal));
      return d === "stop" || d === null || d.productId !== productId ? null : d.imageUrl;
    } catch {
      return null;
    }
  };
  const photos = await Promise.all(
    kept.map((k) => (k.idea.imageUrl !== null || k.photo === null ? k.idea.imageUrl : photo(k.photo.retailer, k.photo.productId))),
  );
  const count = await store.save(
    runId,
    kept.map((k, i) => ({ ...k.idea, imageUrl: photos[i], rank: i + 1 })),
  );
  await store.finish(runId, "saved", cents(t.spent));
  return { status: "saved", count };
}

type Lookup = <T>(call: () => Promise<T>, still?: () => boolean) => Promise<T | "stop">;
type PassDeps = { req: IdeaRequest; deps: IdeaDeps; s: IdeaSettings; ctx: JudgeContext; runId: string; lookup: Lookup };

/** An idea ready to save, but for its rank and a photo still to fetch (`photo`: where to ask). */
type Kept = { idea: Omit<SavedIdea, "rank">; photo: { retailer: ZincRetailer; productId: string } | null; amazonId: string | null };

const ON_THEIR_LIST = "On their list";

/**
 * The list pass (AC-27): each gift, in list order, priced through listGiftQuote and judged.
 * Gifts start one after another as soon as the one before has taken its first lookup, so their
 * lookups run at the rate limit rather than one reply at a time. It stops at
 * idea_list_lookups_max lookups, or once idea_keep_max qualify. Every lookup is charged through
 * the run's `lookup`. Events carry the route and outcome only (E6): never the title or link.
 */
async function listPass(gifts: ListGift[], p: PassDeps & { stopped: () => boolean; halt: () => void }): Promise<Kept[]> {
  const { req, deps, s, ctx, runId, lookup } = p;
  let lookups = 0;
  let qualified = 0;
  const enough = () => qualified >= s.keepMax;
  const noExclusions: JudgeContext = { ...ctx, excluded: new Set() };

  const quoteOne = async (g: ListGift, entered: () => void): Promise<Kept | null> => {
    const route = listGiftRoute(g.url, g.asin);
    const routeName = route.kind === "check" ? "check" : route.retailer;
    const note = (outcome: string, kind?: ZincErrorKind) =>
      logEvent("ideas.list_gift", { run_id: runId, route: routeName, outcome, ...(kind ? { kind } : {}) });
    const retailer = storeName(g.url);
    if (retailer === null) {
      note("unsupported");
      return null;
    }
    const step: ZincStep = async <T>(call: () => Promise<T>): Promise<T | "stop"> => {
      if (lookups >= s.listLookupsMax || enough()) return "stop";
      lookups++;
      entered();
      return lookup(call, () => !enough());
    };
    try {
      const q = await listGiftQuote(deps.zinc.http, deps.zinc.key, { url: g.url, asin: g.asin, listPriceCents: g.listPriceCents }, step, req.signal);
      if (q.kind === "stopped" || q.kind === "unsupported") {
        note(q.kind);
        return null;
      }
      const planned = s.schedule.planningDeliveryDays;
      // Unknown delivery is judged as planning_delivery_days, as a gift Zinc can only check is.
      const offer: ZincOffer =
        q.kind === "listed"
          ? {
              offerId: null,
              priceCents: q.priceCents,
              shippingCents: 0,
              available: true,
              condition: "New",
              buyBox: false,
              firstParty: false,
              sellerName: null,
              handlingDaysMax: 0,
              deliveryDaysMin: planned,
              deliveryDaysMax: planned,
            }
          : q.deliveryKnown
            ? q.offer
            : { ...q.offer, handlingDaysMax: 0, deliveryDaysMin: planned, deliveryDaysMax: planned };
      // A product given or rejected as an AI idea isn't offered from the list either (the brainstorm's ideas are Amazon's).
      const amazonId = route.kind === "offers" && route.retailer === "amazon" ? route.productId : null;
      const v = judgeCandidate({ productId: amazonId ?? g.itemId, offer }, amazonId ? ctx : noExclusions, s.schedule);
      if (!v.keep) {
        note(v.reason);
        return null;
      }
      qualified++;
      note("kept");
      const productId = q.kind === "offer" ? q.productId : null;
      return {
        idea: {
          title: g.name,
          retailer,
          productUrl: g.url,
          retailerProductId: productId,
          offerId: offer.offerId,
          sellerName: offer.sellerName,
          firstParty: offer.firstParty,
          priceCents: offer.priceCents,
          estShippingCents: offer.shippingCents,
          estTaxCents: taxCents(offer.priceCents, s),
          estTotalCents: v.totalCents,
          handlingDaysMax: offer.handlingDaysMax,
          deliveryDaysMin: offer.deliveryDaysMin,
          deliveryDaysMax: offer.deliveryDaysMax,
          arriveBy: v.arriveBy,
          reason: ON_THEIR_LIST,
          overBudget: v.fit === "over",
          imageUrl: q.kind === "offer" ? q.imageUrl : null,
          source: "list",
          listItemId: g.itemId,
        },
        // The offers lookup has no photo: ask the product's details. A details reply already said.
        photo: route.kind === "offers" ? { retailer: route.retailer, productId: route.productId } : null,
        amazonId,
      };
    } catch (e) {
      if (e instanceof ZincError) {
        // The kind only: a Shopify path holds the product handle (E6).
        note("vendor_error", e.kind);
        return null;
      }
      p.halt();
      throw e;
    }
  };

  const tasks: Promise<Kept | null>[] = [];
  for (const g of gifts) {
    if (lookups >= s.listLookupsMax || enough() || p.stopped() || req.signal.aborted) break;
    let release!: () => void;
    const entered = new Promise<void>((r) => (release = r));
    const task = quoteOne(g, release).finally(release);
    // Awaited below with the rest; this only keeps an early failure from going unhandled meanwhile.
    task.catch(() => {});
    tasks.push(task);
    await entered;
  }
  // Settled, not Promise.all: every call that started is counted before the run moves on.
  const settled = await Promise.allSettled(tasks);
  const failure = settled.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  return settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((k): k is Kept => k !== null)
    .slice(0, s.keepMax);
}

/** The same flat tax judgeCandidate puts in the total. */
function taxCents(priceCents: number, s: IdeaSettings): number {
  return Math.round((priceCents * s.taxPct) / 100);
}

/**
 * The brainstorm (ALL-27): ask the AI, look each candidate up on Zinc, judge, rank and keep up to
 * idea_keep_max less the list gifts already kept. Returns the ideas to save, or how the run ends
 * when it has none.
 */
async function brainstormPass(
  inputs: IdeaInputs,
  plan: Plan,
  listed: Kept[],
  p: PassDeps & {
    t: Tally;
    dropped: (reason: DropReason, kind?: ZincErrorKind) => void;
    capped: () => boolean;
    halt: () => void;
  },
): Promise<{ kept: Kept[] } | { end: RunEnd }> {
  const { req, deps, s, ctx, runId, t, lookup, dropped } = p;
  const { store } = deps;
  // After start, so a failure here is a counted, failed run (retried, then no_ideas) rather than a silent round.
  const prices = await gatewayPrices(deps.gateway, AI_MODELS.ideas, req.signal);

  // ─── brainstorm ── names (AC-21), contact details (ALL-134) and list gift titles never reach the AI (T42) ──
  const names = inputs.names;
  const forAi = (text: string) => stripContactDetails(redactNames(text, names));
  const relationship = relationshipLabel(inputs.relationship).toLowerCase();
  const facts = inputs.facts.map((f) => forAi(`${f.category}: ${f.value}${f.source === "capture" ? " (captured)" : ""}`));
  // An AI call cut off mid-way may have spent, but no reply says how much: the run's cost is then unknown.
  const ai = async <T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(s.aiTimeoutMs)]);
    try {
      return await call(signal);
    } catch (e) {
      if (signal.aborted) t.costUnknown = true;
      throw e;
    }
  };
  // After "Too pricey", the search stays under the cheapest rejected idea's total (AC-12).
  const budgetCents =
    ctx.maxTotalCents === null ? plan.budgetCents : Math.min(plan.budgetCents ?? ctx.maxTotalCents, ctx.maxTotalCents);
  const b = await ai((signal) =>
    brainstorm(
      deps.gateway,
      {
        relationship,
        occasion: plan.occasion,
        budgetCents,
        facts,
        avoidTitles: inputs.avoidTitles.map(forAi),
      },
      { candidates: s.candidates, maxSearches: s.maxSearches, maxTokens: s.aiMaxTokens, overBudgetPct: inputs.overBudgetPct, prices, signal },
    ),
  );
  t.spent += b.costCents;
  t.candidates = b.candidates.length;
  t.stage = "brainstormed";
  await store.progress(runId, "brainstormed", cents(t.spent));

  const searchable = b.candidates.filter((c) => {
    if (!mentionsName(c.search, names)) return true;
    dropped("names");
    return false;
  });

  // ─── resolve, all candidates at once (B2), capped by cost and rate ──
  const resolveOne = async (c: IdeaCandidate): Promise<Resolved> => {
    try {
      const hits = await lookup(() => searchProducts(deps.zinc.http, deps.zinc.key, c.search, req.signal));
      if (hits === "stop") return { stopped: true };
      const hit = matchHit(hits, c.brand);
      if (!hit) return { drop: "not_found" };
      const offers = await lookup(() => productOffers(deps.zinc.http, deps.zinc.key, "amazon", hit.productId, req.signal));
      if (offers === "stop") return { stopped: true };
      const offer = pickOffer(offers);
      if (!offer) return { drop: "unavailable" };
      const v = judgeCandidate({ productId: hit.productId, offer }, ctx, s.schedule);
      if (!v.keep) return { drop: v.reason };
      return { found: { c, hit, offer, totalCents: v.totalCents, fit: v.fit, arriveBy: v.arriveBy } };
    } catch (e) {
      if (e instanceof ZincError) return { drop: "vendor_error", kind: e.kind };
      p.halt();
      throw e;
    }
  };
  // Settled, not Promise.all: every call that started is counted before the run can finish.
  const settled = await Promise.allSettled(searchable.map(resolveOne));
  const failure = settled.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  const found: Found[] = [];
  const drops: { drop: DropReason; kind?: ZincErrorKind }[] = [];
  // A product already kept from the list isn't offered twice.
  const products = new Set<string>(listed.map((k) => k.amazonId).filter((id) => id !== null));
  for (const one of settled) {
    if (one.status !== "fulfilled") continue;
    const r = one.value;
    // Two searches can land on one product; it's saved once (the first candidate keeps it).
    if ("found" in r && products.has(r.found.hit.productId)) {
      drops.push({ drop: "duplicate" });
      dropped("duplicate");
    } else if ("found" in r) {
      products.add(r.found.hit.productId);
      found.push(r.found);
    } else if ("drop" in r) {
      drops.push(r);
      dropped(r.drop, r.kind);
    }
  }
  t.resolved = found.length;
  t.stage = "resolved";
  await store.progress(runId, "resolved", cents(t.spent));

  if (req.signal.aborted) return { end: "deadline" };
  if (p.capped()) return { end: "cost_cap" };
  if (found.length === 0 && drops.length > 0 && drops.every((d) => d.drop === "vendor_error")) {
    if (drops.some((d) => d.kind === "unauthorized")) {
      logEvent("ideas.zinc_unauthorized", { ...ids(req, runId), alert: true });
    }
    return { end: "failed" };
  }
  if (found.length === 0) return { end: "none" };

  // ─── rank, only if its worst case fits under the cap (S3) ──
  const byId = new Map(found.map((f) => [f.c.id, f]));
  const rankInput = {
    relationship,
    facts,
    options: found.map((f) => ({ id: f.c.id, title: redactNames(f.hit.title, names), totalCents: f.totalCents, fit: f.fit })),
  };
  const worst = rankWorstCents(prices, s.aiMaxTokens, rankInputTokensMax(rankInput, s));
  if (!canAffordRank(t.spent, worst, s.runMaxCents)) return { end: "cost_cap" };
  const r = await ai((signal) => rank(deps.gateway, rankInput, { maxTokens: s.aiMaxTokens, keepMin: s.keepMin, keepMax: s.keepMax, prices, signal }));
  t.spent += r.costCents;
  t.stage = "ranked";
  await store.progress(runId, "ranked", cents(t.spent));

  // ─── the sensitive-trait filter, then keep (S4, AC-1) ──
  const seen = new Set<string>();
  const ranked: (Found & { reason: string })[] = [];
  for (const { id, reason } of r.order) {
    const f = byId.get(id);
    if (!f || seen.has(id)) continue;
    seen.add(id);
    if (isSensitive(f.hit.title) || isSensitive(f.c.title) || isSensitive(reason)) {
      dropped("sensitive");
      continue;
    }
    ranked.push({ ...f, reason });
  }
  const kept = keepIdeas(ranked, Math.max(0, s.keepMax - listed.length));
  if (kept.length === 0) return { end: "none" };
  return { kept: kept.map((k) => toKept(k, s)) };
}

function toKept(k: Found & { reason: string }, s: IdeaSettings): Kept {
  const { offer } = k;
  return {
    idea: {
      title: k.hit.title,
      retailer: AMAZON,
      productUrl: `https://www.amazon.com/dp/${k.hit.productId}`,
      retailerProductId: k.hit.productId,
      offerId: offer.offerId,
      sellerName: offer.sellerName,
      firstParty: offer.firstParty,
      priceCents: offer.priceCents,
      estShippingCents: offer.shippingCents,
      estTaxCents: taxCents(offer.priceCents, s),
      estTotalCents: k.totalCents,
      handlingDaysMax: offer.handlingDaysMax,
      deliveryDaysMin: offer.deliveryDaysMin,
      deliveryDaysMax: offer.deliveryDaysMax,
      arriveBy: k.arriveBy,
      reason: k.reason,
      overBudget: k.fit === "over",
      // The search hit's photo when it has one; otherwise one details call before saving (AC-17).
      imageUrl: k.hit.imageUrl ?? null,
      source: "generated",
      listItemId: null,
    },
    photo: { retailer: AMAZON, productId: k.hit.productId },
    amazonId: k.hit.productId,
  };
}

/**
 * Which occasion, budget and dates a run judges against. A round uses its own,
 * with its deadline as the order date. On demand uses the next occasion an
 * order today can still reach, with its budget in T73's order; with none, the
 * base or default budget and no arrival check.
 */
type Plan = { occasion: string | null; occasionDate: CalendarDate | null; orderDate: CalendarDate; budgetCents: number | null };

function occasionPlan(inputs: IdeaInputs, today: CalendarDate, s: ScheduleSettings): Plan {
  const label = (kind: string) => kind.replaceAll("_", " ");
  if (inputs.round) {
    return {
      occasion: label(inputs.round.occasion),
      occasionDate: inputs.round.occasionDate,
      orderDate: inputs.round.shipByDeadline,
      budgetCents: inputs.round.budgetCents,
    };
  }
  const dated = inputs.occasions.map((o) => ({ date: nextOccurrence(o.rule, today), ownBudgetCents: o.ownBudgetCents, kind: o.rule.kind }));
  const picked = onDemandOccasion(dated, today, s);
  const next = dated.find((d) => d === picked) ?? null;
  return {
    occasion: next ? label(next.kind) : null,
    occasionDate: next?.date ?? null,
    orderDate: today,
    budgetCents: appliedBudget(next?.ownBudgetCents ?? null, inputs.baseBudgetCents, inputs.defaultBudgetCents),
  };
}

/**
 * Spaces calls at least 1000 / perSecond ms apart, so a fractional rate holds too
 * (a share of Zinc's rate, ALL-125). Callers wait their turn in order.
 */
function limiter(perSecond: number, clock: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  const gap = SECOND_MS / perSecond;
  let last: number | null = null;
  let queue: Promise<void> = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      if (last !== null) {
        const wait = last + gap - clock();
        if (wait > 0) await sleep(Math.ceil(wait));
      }
      last = clock();
    });
    // One caller's failure mustn't decide the others' turns; the run's own stop flag does that.
    queue = turn.catch(() => {});
    return turn;
  };
}
