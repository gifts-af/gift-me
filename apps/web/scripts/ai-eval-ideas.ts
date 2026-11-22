// The `--ideas` mode of `pnpm ai:eval` (ALL-27, AC-22). SPENDS MONEY: it calls the real AI Gateway
// and Zinc. Run by hand with Jim's go-ahead, never in CI. Called from ai-eval.ts.
// Contact stripping (ALL-134) isn't skipped here: the fixture facts go through runIdeas, which strips them.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addDays,
  canArriveInTime,
  classifyTotal,
  estimatedTotalCents,
  type CalendarDate,
  type OccasionKind,
  type ScheduleSettings,
} from "@gifts-af/core";
import { isSensitive } from "../lib/ai/sensitive";
import { runIdeas, type IdeaDeps } from "../modules/concierge/ideas/run";
import type { IdeaInputs, IdeaSettings, IdeaStore, RunEnd, RunStage, SavedIdea } from "../modules/concierge/ideas/store";

type Person = { id: string; name: string; relationship: string; occasion: string; budget_cents: number; facts: string[] };
type Env = Record<string, string | undefined>;

// The fixture's relationships aren't the app's; these are, by person.
const RELATIONSHIP: Record<string, string> = { dad: "father", maya: "sister", june: "grandmother", sam: "brother", priya: "friend" };
const CATEGORIES = ["interest", "dislike", "size", "brand", "owns", "wants", "style", "avoid", "constraint"] as const;

// The eval's own scenario, not app values: each person's occasion is this many days out, and the
// order must be placed this many days from now (like a round's ship-by deadline).
const OCCASION_IN_DAYS = 28;
const ORDER_BY_IN_DAYS = 14;
// The shipping defaults of the migration's app_settings rows (20261117100000_idea_engine, 20261122160000_approval and earlier),
// since there is no database here. Change them here if the migration's change.
const SETTINGS: IdeaSettings = {
  enabled: true,
  candidates: 8,
  maxSearches: 3,
  aiMaxTokens: 6000,
  aiTimeoutMs: 60000,
  keepMin: 3,
  keepMax: 5,
  taxPct: 8,
  runMaxCents: 100,
  zincLookupCents: 1,
  zincRequestsPerSecond: 10,
  orderFeeCents: 100,
  listLookupsMax: 10,
  listMin: 3,
  schedule: {
    planningDeliveryDays: 7,
    safetyBufferDays: 2,
    roundLeadDays: 28,
    reminder1AfterHeadsUpDays: 5,
    reminder2BeforeDeadlineDays: 7,
    finalNoticeBeforeDeadlineDays: 2,
    fastestDaysToArrive: 1,
    holdReminderDays: 7,
    holdFinalDays: 2,
  } satisfies ScheduleSettings,
};
const ZINC_TIMEOUT_MS = 15000; // idea_zinc_timeout_ms
const OVER_BUDGET_PCT = 15; // default_over_budget_pct
const AI_CENTS_MAX_DEFAULT = 25; // the top of the spec's 20-25 cents (S10)

/** One run's in-memory IdeaStore, from a fixture person. Records what the checks and the cost split need. */
function memoryStore(p: Person, inputs: IdeaInputs) {
  const rec = { saved: [] as SavedIdea[], progress: {} as Partial<Record<RunStage, number>>, total: 0, outcome: "" as RunEnd | "" };
  const store: IdeaStore = {
    settings: async () => SETTINGS,
    hasPaidFeatures: async () => true,
    inputs: async () => inputs,
    start: async () => ({ runId: `eval-${p.id}` }),
    progress: async (_id, stage, cost) => void (rec.progress[stage] = cost),
    finish: async (_id, outcome, cost) => {
      rec.outcome = outcome;
      rec.total = cost;
    },
    save: async (_id, ideas) => {
      rec.saved = ideas;
      return ideas.length;
    },
  };
  return { store, rec };
}

function inputsFor(p: Person, today: CalendarDate): IdeaInputs {
  const facts = p.facts.map((line, i) => {
    const [head, ...rest] = line.split(": ");
    const known = (CATEGORIES as readonly string[]).includes(head);
    return {
      id: `${p.id}-${i}`,
      category: (known ? head : "constraint") as IdeaInputs["facts"][number]["category"],
      value: known ? rest.join(": ") : line,
      source: "manual",
      sourceId: null,
      confirmed: true,
    };
  });
  return {
    relationship: RELATIONSHIP[p.id],
    names: p.name.split(/\s+/).sort((a, b) => b.length - a.length),
    facts,
    excluded: [],
    avoidTitles: [],
    overBudgetPct: OVER_BUDGET_PCT,
    round: {
      occasion: p.occasion as OccasionKind,
      occasionDate: addDays(today, OCCASION_IN_DAYS),
      shipByDeadline: addDays(today, ORDER_BY_IN_DAYS),
      budgetCents: p.budget_cents,
      maxTotalCents: null,
    },
    occasions: [],
    baseBudgetCents: null,
    defaultBudgetCents: null,
    listGifts: [],
  };
}

/** AC-2, AC-5 and AC-6 on one kept idea. Returns what failed. */
function failures(i: SavedIdea, inputs: IdeaInputs): string[] {
  const out: string[] = [];
  const round = inputs.round!;
  // AC-2: a real product with a live price and delivery from a Zinc offer.
  if (!i.retailerProductId || !i.productUrl.includes(i.retailerProductId)) out.push("AC-2: no real product id");
  if (!(i.priceCents > 0)) out.push("AC-2: no price");
  if (i.deliveryDaysMax < i.deliveryDaysMin || i.handlingDaysMax < 0) out.push("AC-2: delivery days make no sense");
  // AC-5: arrives in time with the safety buffer to spare.
  if (!canArriveInTime({ occasionDate: round.occasionDate, orderDate: round.shipByDeadline, handlingDaysMax: i.handlingDaysMax, deliveryDaysMax: i.deliveryDaysMax }, SETTINGS.schedule)) {
    out.push("AC-5: would arrive too late");
  }
  // AC-6: the total and its budget class come from the core rules; nothing sensitive.
  const total = estimatedTotalCents({
    priceCents: i.priceCents,
    shippingCents: i.estShippingCents,
    taxCents: Math.round((i.priceCents * SETTINGS.taxPct) / 100),
    feeCents: SETTINGS.orderFeeCents,
  });
  if (total !== i.estTotalCents) out.push(`AC-6: total ${i.estTotalCents} should be ${total}`);
  const fit = classifyTotal(i.estTotalCents, round.budgetCents, inputs.overBudgetPct);
  if (fit === "dropped" || (fit === "over") !== i.overBudget) out.push(`AC-6: budget class ${fit} but over_budget=${i.overBudget}`);
  if (isSensitive(i.title) || isSensitive(i.reason)) out.push("AC-6: sensitive topic in the idea");
  return out;
}

/** Returns the process exit code. Refuses, before any network call, without every vendor setting. */
export async function runIdeasEval(args: string[], env: Env): Promise<number> {
  const missing = ["AI_GATEWAY_BASE", "AI_GATEWAY_API_KEY", "ZINC_API_BASE", "ZINC_API_KEY"].filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`Not running: ${missing.join(", ")} not set. This mode spends money, so it needs all four (design/operations.md > ai:eval --ideas).`);
    return 1;
  }
  const at = args.indexOf("--ai-cents-max");
  const aiMax = at === -1 ? AI_CENTS_MAX_DEFAULT : Number(args[at + 1]);
  if (!Number.isFinite(aiMax) || aiMax < 0) {
    console.error("--ai-cents-max needs a number of cents.");
    return 1;
  }
  const people = JSON.parse(readFileSync(path.resolve(__dirname, "../lib/ai/fixtures/people.json"), "utf8")) as Person[];
  const today = new Date().toISOString().slice(0, 10);
  const deps = (store: IdeaStore): IdeaDeps => ({
    store,
    gateway: { base: env.AI_GATEWAY_BASE!, apiKey: env.AI_GATEWAY_API_KEY!, fetch },
    zinc: { http: { base: env.ZINC_API_BASE!, timeoutMs: ZINC_TIMEOUT_MS, fetch }, key: env.ZINC_API_KEY! },
    today,
    clock: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  let failed = false;
  const rows: Record<string, string | number>[] = [];
  for (const p of people) {
    const inputs = inputsFor(p, today);
    const { store, rec } = memoryStore(p, inputs);
    const outcome = await runIdeas(
      { userId: "eval-user", personId: p.id, roundId: `eval-round-${p.id}`, signal: AbortSignal.timeout(SETTINGS.aiTimeoutMs * 3) },
      deps(store),
    );
    // The run reports one running total, so the split is read from its records: what it added
    // between "brainstormed" and "resolved" is the Zinc lookups; AI is the total minus that.
    const zinc = rec.progress.resolved !== undefined ? rec.progress.resolved - (rec.progress.brainstormed ?? 0) : 0;
    const ai = rec.total - zinc;
    const problems = rec.saved.flatMap((i) => failures(i, inputs).map((f) => `${i.rank}: ${f}`));
    if (outcome.status !== "saved") problems.push(`outcome ${outcome.status}`);
    if (ai > aiMax) problems.push(`AI cost ${ai}c is over ${aiMax}c`);
    if (problems.length > 0) failed = true;
    rows.push({ person: p.id, outcome: outcome.status, kept: rec.saved.length, ai_cents: ai, zinc_cents: zinc, total_cents: rec.total, problems: problems.join("; ") });
  }
  console.table(rows);
  console.log(failed ? "FAIL: see problems above." : `PASS: every idea passes AC-2, AC-5 and AC-6; AI cost at or under ${aiMax}c per run.`);
  return failed ? 1 : 0;
}
