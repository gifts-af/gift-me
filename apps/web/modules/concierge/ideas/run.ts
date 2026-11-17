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
import { ZincError, type ZincErrorKind, type ZincHttp } from "../zinc/client";
import { productOffers, searchProducts } from "../zinc/products";
import type { IdeaInputs, IdeaRefusal, IdeaSettings, IdeaStore, RunEnd, SavedIdea } from "./store";

// One idea run (ALL-27): brainstorm, look each candidate up on Zinc, judge it,
// rank, and save. Every number is a setting and every client arrives in
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
};

/** A true constant: the rate limit is per second. */
const SECOND_MS = 1000;
const AMAZON = "amazon";

/** What the closing `ideas.run` event reports. */
type Tally = {
  runId: string | null;
  stage: "checks" | "started" | "brainstormed" | "resolved" | "ranked";
  spent: number;
  candidates: number;
  resolved: number;
  kept: number;
  keepMin: number | null;
  refusal: IdeaRefusal | null;
  error: { name: string; kind: string | null } | null;
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
    candidates: 0,
    resolved: 0,
    kept: 0,
    keepMin: null,
    refusal: null,
    error: null,
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
  if (inputs.facts.length === 0) return { status: "no_facts" };
  // The price listing is free, so a failure here counts no run.
  const prices = await gatewayPrices(deps.gateway, AI_MODELS.ideas, req.signal);
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

  // ─── brainstorm ── names never reach the AI (AC-21) ──
  const names = inputs.names;
  const relationship = relationshipLabel(inputs.relationship).toLowerCase();
  const facts = inputs.facts.map((f) => redactNames(`${f.category}: ${f.value}${f.source === "capture" ? " (captured)" : ""}`, names));
  const aiSignal = () => AbortSignal.any([req.signal, AbortSignal.timeout(s.aiTimeoutMs)]);
  const b = await brainstorm(
    deps.gateway,
    {
      relationship,
      occasion: plan.occasion,
      budgetCents: plan.budgetCents,
      facts,
      avoidTitles: inputs.avoidTitles.map((title) => redactNames(title, names)),
    },
    { candidates: s.candidates, maxSearches: s.maxSearches, maxTokens: s.aiMaxTokens, prices, signal: aiSignal() },
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
  const limit = limiter(s.zincRequestsPerSecond, deps.clock, deps.sleep);
  let capped = false;
  // Set when a lookup fails with an error that ends the run: no new paid call starts after it.
  let stopping = false;
  const lookup = async <T>(call: () => Promise<T>): Promise<T | "stop"> => {
    if (capped || stopping || req.signal.aborted) return "stop";
    await limit();
    if (stopping || req.signal.aborted) return "stop";
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
  };
  const resolveOne = async (c: IdeaCandidate): Promise<Resolved> => {
    try {
      const hits = await lookup(() => searchProducts(deps.zinc.http, deps.zinc.key, c.search, req.signal));
      if (hits === "stop") return { stopped: true };
      const hit = matchHit(hits, c.brand);
      if (!hit) return { drop: "not_found" };
      const offers = await lookup(() => productOffers(deps.zinc.http, deps.zinc.key, hit.productId, req.signal));
      if (offers === "stop") return { stopped: true };
      const offer = pickOffer(offers);
      if (!offer) return { drop: "unavailable" };
      const v = judgeCandidate({ productId: hit.productId, offer }, ctx, s.schedule);
      if (!v.keep) return { drop: v.reason };
      return { found: { c, hit, offer, totalCents: v.totalCents, fit: v.fit, arriveBy: v.arriveBy } };
    } catch (e) {
      if (e instanceof ZincError) return { drop: "vendor_error", kind: e.kind };
      stopping = true;
      throw e;
    }
  };
  // Settled, not Promise.all: every call that started is counted before the run can finish.
  const settled = await Promise.allSettled(searchable.map(resolveOne));
  const failure = settled.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  const found: Found[] = [];
  const drops: { drop: DropReason; kind?: ZincErrorKind }[] = [];
  const products = new Set<string>();
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

  if (req.signal.aborted) return end("deadline");
  if (capped) return end("cost_cap");
  if (found.length === 0 && drops.length > 0 && drops.every((d) => d.drop === "vendor_error")) {
    if (drops.some((d) => d.kind === "unauthorized")) {
      logEvent("ideas.zinc_unauthorized", { ...ids(req, runId), alert: true });
    }
    return end("failed");
  }
  if (found.length === 0) return end("none");

  // ─── rank, only if its worst case fits under the cap (S3) ──
  const byId = new Map(found.map((f) => [f.c.id, f]));
  const rankInput = {
    relationship,
    facts,
    options: found.map((f) => ({ id: f.c.id, title: redactNames(f.hit.title, names), totalCents: f.totalCents, fit: f.fit })),
  };
  const worst = rankWorstCents(prices, s.aiMaxTokens, rankInputTokensMax(rankInput));
  if (!canAffordRank(t.spent, worst, s.runMaxCents)) return end("cost_cap");
  const r = await rank(deps.gateway, rankInput, { maxTokens: s.aiMaxTokens, prices, signal: aiSignal() });
  t.spent += r.costCents;
  t.stage = "ranked";
  await store.progress(runId, "ranked", cents(t.spent));

  // ─── the sensitive-trait filter, then keep and save (S4, AC-1) ──
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
  const kept = keepIdeas(ranked, s.keepMax);
  t.kept = kept.length;
  if (kept.length === 0) return end("none");

  const count = await store.save(
    runId,
    kept.map((k, i) => toSaved(k, i + 1, s)),
  );
  await store.finish(runId, "saved", cents(t.spent));
  return { status: "saved", count };
}

function toSaved(k: Found & { reason: string }, rankNo: number, s: IdeaSettings): SavedIdea {
  const { offer } = k;
  // The same flat tax judgeCandidate puts in the total.
  const tax = Math.round((offer.priceCents * s.taxPct) / 100);
  return {
    title: k.hit.title,
    retailer: AMAZON,
    productUrl: `https://www.amazon.com/dp/${k.hit.productId}`,
    retailerProductId: k.hit.productId,
    offerId: offer.offerId,
    sellerName: offer.sellerName,
    firstParty: offer.firstParty,
    priceCents: offer.priceCents,
    estShippingCents: offer.shippingCents,
    estTaxCents: tax,
    estTotalCents: k.totalCents,
    handlingDaysMax: offer.handlingDaysMax,
    deliveryDaysMin: offer.deliveryDaysMin,
    deliveryDaysMax: offer.deliveryDaysMax,
    arriveBy: k.arriveBy,
    reason: k.reason,
    overBudget: k.fit === "over",
    rank: rankNo,
  };
}

/**
 * Which occasion, budget and dates a run judges against. A round uses its own,
 * with its deadline as the order date. On demand uses the next occasion an
 * order today can still reach, with its budget in T73's order; with none, the
 * base or default budget and no arrival check.
 */
function occasionPlan(
  inputs: IdeaInputs,
  today: CalendarDate,
  s: ScheduleSettings,
): { occasion: string | null; occasionDate: CalendarDate | null; orderDate: CalendarDate; budgetCents: number | null } {
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

/** Lets no more than `perSecond` calls start in any one-second window. Callers wait their turn in order. */
function limiter(perSecond: number, clock: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  const starts: number[] = [];
  let queue: Promise<void> = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      for (;;) {
        const now = clock();
        while (starts.length > 0 && starts[0] <= now - SECOND_MS) starts.shift();
        if (starts.length < perSecond) {
          starts.push(now);
          return;
        }
        await sleep(starts[0] + SECOND_MS - now);
      }
    });
    // One caller's failure mustn't decide the others' turns; the run's own stop flag does that.
    queue = turn.catch(() => {});
    return turn;
  };
}
