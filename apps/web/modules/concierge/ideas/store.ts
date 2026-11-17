import "server-only";
import type { CalendarDate, OccasionKind, OccasionRule, ScheduleSettings } from "@gifts-af/core";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hasPaidFeatures } from "../paid-features";
import { activeFacts, type ActiveFact } from "../profile/profile";

// Everything one idea run needs from the database (ALL-27). runIdeas works on
// this interface, so its tests use an in-memory store; this file is thin glue
// on the service-role client (the server writes runs and ideas, T26). Limits,
// leases and saving live in SQL (migration 20261117100000_idea_engine).

export type AdminDb = ReturnType<typeof createAdminClient>;

export type IdeaRefusal = "not_found" | "not_paid" | "done" | "busy" | "limit";

/** Every number a run uses, from concierge.app_settings (T23). */
export type IdeaSettings = {
  enabled: boolean;
  candidates: number;
  maxSearches: number;
  aiMaxTokens: number;
  aiTimeoutMs: number;
  keepMin: number;
  keepMax: number;
  taxPct: number;
  runMaxCents: number;
  zincLookupCents: number;
  zincRequestsPerSecond: number;
  orderFeeCents: number;
  schedule: ScheduleSettings;
};

/** What a run knows about the person, before any choice of occasion or budget. */
export type IdeaInputs = {
  /** The stored relationship, e.g. "father". */
  relationship: string;
  /** Each word of the person's and the buyer's names, longest first. Never logged. */
  names: string[];
  facts: ActiveFact[];
  /** Retailer product ids already given or rejected for this person. */
  excluded: string[];
  /** Titles of those ideas, so the AI doesn't suggest them again. */
  avoidTitles: string[];
  overBudgetPct: number;
  /** A round's own occasion, date, deadline and budget; null on demand. */
  round: { occasion: OccasionKind; occasionDate: CalendarDate; shipByDeadline: CalendarDate; budgetCents: number | null } | null;
  /** On demand: the person's enabled occasions, each with its own budget. */
  occasions: { rule: OccasionRule; ownBudgetCents: number | null }[];
  /** The person's base budget (a budgets row of kind 'any', T73). */
  baseBudgetCents: number | null;
  /** The buyer's default for this relationship. */
  defaultBudgetCents: number | null;
};

/** One idea to save, every price and day from a live Zinc offer (AC-2). */
export type SavedIdea = {
  title: string;
  retailer: string;
  productUrl: string;
  retailerProductId: string;
  offerId: string | null;
  sellerName: string | null;
  firstParty: boolean;
  priceCents: number;
  estShippingCents: number;
  estTaxCents: number;
  estTotalCents: number;
  handlingDaysMax: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  arriveBy: CalendarDate | null;
  reason: string;
  overBudget: boolean;
  rank: number;
};

export type RunStage = "brainstormed" | "resolved" | "ranked";
export type RunEnd = "saved" | "none" | "failed" | "cost_cap" | "deadline";

export interface IdeaStore {
  settings(): Promise<IdeaSettings>;
  hasPaidFeatures(userId: string): Promise<boolean>;
  /** Null when the person (or the round) isn't a live one of this buyer's. */
  inputs(req: { userId: string; personId: string; roundId: string | null }): Promise<IdeaInputs | null>;
  start(
    req: { userId: string; personId: string; roundId: string | null },
    now: Date,
  ): Promise<{ runId: string } | { refused: IdeaRefusal }>;
  /** costCents is whole cents, the spend so far. */
  progress(runId: string, stage: RunStage, costCents: number): Promise<void>;
  finish(runId: string, outcome: RunEnd, costCents: number): Promise<void>;
  save(runId: string, ideas: SavedIdea[]): Promise<number>;
}

const SETTING_KEYS = {
  enabled: "idea_engine_enabled",
  candidates: "idea_candidates",
  maxSearches: "idea_max_searches",
  aiMaxTokens: "idea_ai_max_tokens",
  aiTimeoutMs: "idea_ai_timeout_ms",
  keepMin: "idea_keep_min",
  keepMax: "idea_keep_max",
  taxPct: "idea_tax_estimate_pct",
  runMaxCents: "idea_run_max_cents",
  zincLookupCents: "zinc_lookup_cents",
  zincRequestsPerSecond: "zinc_requests_per_second",
  orderFeeCents: "zinc_order_fee_cents",
} as const;

const SCHEDULE_KEYS: Record<keyof ScheduleSettings, string> = {
  planningDeliveryDays: "planning_delivery_days",
  safetyBufferDays: "safety_buffer_days",
  roundLeadDays: "round_lead_days",
  reminder1AfterHeadsUpDays: "reminder_1_after_heads_up_days",
  reminder2BeforeDeadlineDays: "reminder_2_before_deadline_days",
  finalNoticeBeforeDeadlineDays: "final_notice_before_deadline_days",
  fastestDaysToArrive: "fastest_days_to_arrive",
  holdReminderDays: "hold_reminder_days",
  holdFinalDays: "hold_final_days",
};

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** Each word of each name, once, longest first (so "Mary Jane" can't leave "Jane" behind). */
function nameWords(names: (string | null | undefined)[]): string[] {
  const words = new Set(names.flatMap((n) => (n ?? "").split(/\s+/)).filter((w) => w.length > 0));
  return [...words].sort((a, b) => b.length - a.length);
}

function toRule(kind: string, month: number | null, day: number | null): OccasionRule {
  if (kind === "birthday" || kind === "anniversary") {
    if (month === null || day === null) throw new Error(`A ${kind} occasion has no date`);
    return { kind, month, day };
  }
  return { kind: kind as Exclude<OccasionKind, "birthday" | "anniversary"> };
}

export function createSupabaseIdeaStore(db: AdminDb): IdeaStore {
  const concierge = db.schema("concierge");

  async function setting(key: string): Promise<number> {
    const { data, error } = await concierge.rpc("setting_int", { p_key: key });
    if (error) fail(`Reading setting ${key} failed`, error);
    if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
    return data;
  }

  async function readMap<K extends string>(keys: Record<K, string>): Promise<Record<K, number>> {
    const names = Object.keys(keys) as K[];
    const values = await Promise.all(names.map((k) => setting(keys[k])));
    return Object.fromEntries(names.map((k, i) => [k, values[i]])) as Record<K, number>;
  }

  return {
    async settings() {
      const [s, schedule] = await Promise.all([readMap(SETTING_KEYS), readMap(SCHEDULE_KEYS)]);
      return { ...s, enabled: s.enabled === 1, schedule };
    },

    hasPaidFeatures: (userId) => hasPaidFeatures(db, userId),

    async inputs({ userId, personId, roundId }) {
      const { data: person, error } = await db
        .from("people")
        .select("name, relationship, recipient_first_name, recipient_last_name")
        .eq("id", personId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) fail("Loading the person failed", error);
      if (!person) return null;

      let round: IdeaInputs["round"] = null;
      if (roundId !== null) {
        const { data: r, error: roundError } = await concierge
          .from("gift_rounds")
          .select("occasion_id, occasion_date, ship_by_deadline, budget_cents")
          .eq("id", roundId)
          .eq("user_id", userId)
          .eq("person_id", personId)
          .maybeSingle();
        if (roundError) fail("Loading the round failed", roundError);
        if (!r) return null;
        const { data: o, error: occasionError } = await concierge
          .from("occasions")
          .select("kind")
          .eq("id", r.occasion_id)
          .single();
        if (occasionError) fail("Loading the round's occasion failed", occasionError);
        round = {
          occasion: o.kind as OccasionKind,
          occasionDate: r.occasion_date,
          shipByDeadline: r.ship_by_deadline,
          budgetCents: r.budget_cents,
        };
      }

      const [buyer, facts, excludedRows, account, occasions, budgets, byDefault] = await Promise.all([
        db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
        activeFacts(db, personId),
        concierge.rpc("excluded_products", { p_person_id: personId }),
        concierge.from("accounts").select("over_budget_pct").eq("user_id", userId).maybeSingle(),
        concierge
          .from("occasions")
          .select("kind, month, day")
          .eq("person_id", personId)
          .eq("user_id", userId)
          .eq("enabled", true)
          .is("deleted_at", null),
        concierge.from("budgets").select("occasion_kind, amount_cents").eq("person_id", personId).eq("user_id", userId),
        concierge
          .from("budget_defaults")
          .select("base_amount_cents")
          .eq("user_id", userId)
          .eq("relationship", person.relationship)
          .maybeSingle(),
      ]);
      if (buyer.error) fail("Loading the buyer failed", buyer.error);
      if (excludedRows.error) fail("Loading excluded products failed", excludedRows.error);
      if (account.error) fail("Loading the account failed", account.error);
      if (!account.data) throw new Error("The buyer has no account row.");
      if (occasions.error) fail("Loading occasions failed", occasions.error);
      if (budgets.error) fail("Loading budgets failed", budgets.error);
      if (byDefault.error) fail("Loading the default budget failed", byDefault.error);

      const excluded = excludedRows.data;
      let avoidTitles: string[] = [];
      if (excluded.length > 0) {
        const { data: titles, error: titleError } = await concierge
          .from("gift_ideas")
          .select("title")
          .eq("user_id", userId)
          .in("retailer_product_id", excluded);
        if (titleError) fail("Loading excluded titles failed", titleError);
        avoidTitles = [...new Set(titles.map((t) => t.title))];
      }

      const budgetFor = (kind: string) => budgets.data.find((b) => b.occasion_kind === kind)?.amount_cents ?? null;

      return {
        relationship: person.relationship,
        names: nameWords([
          person.name,
          person.recipient_first_name,
          person.recipient_last_name,
          buyer.data?.display_name,
        ]),
        facts,
        excluded,
        avoidTitles,
        overBudgetPct: account.data.over_budget_pct,
        round,
        occasions: occasions.data.map((o) => ({ rule: toRule(o.kind, o.month, o.day), ownBudgetCents: budgetFor(o.kind) })),
        baseBudgetCents: budgetFor("any"),
        defaultBudgetCents: byDefault.data?.base_amount_cents ?? null,
      };
    },

    async start({ userId, personId, roundId }, now) {
      const { data, error } = await concierge.rpc("start_idea_run", {
        p_user_id: userId,
        p_person_id: personId,
        // PostgREST takes null for a uuid argument; the generated type says string.
        p_round_id: roundId as string,
        p_now: now.toISOString(),
      });
      if (error) fail("Starting the idea run failed", error);
      const row = data[0];
      if (row?.run_id) return { runId: row.run_id };
      if (!row?.refusal) throw new Error("Starting the idea run returned nothing.");
      return { refused: row.refusal as IdeaRefusal };
    },

    async progress(runId, stage, costCents) {
      const { error } = await concierge
        .from("idea_runs")
        .update({ stage, cost_cents: costCents })
        .eq("id", runId);
      if (error) fail("Saving the run's progress failed", error);
    },

    async finish(runId, outcome, costCents) {
      const { error } = await concierge
        .from("idea_runs")
        .update({ outcome, cost_cents: costCents, finished_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) fail("Finishing the run failed", error);
    },

    async save(runId, ideas) {
      const rows = ideas.map((i) => ({
        title: i.title,
        retailer: i.retailer,
        product_url: i.productUrl,
        retailer_product_id: i.retailerProductId,
        offer_id: i.offerId,
        seller_name: i.sellerName,
        first_party: i.firstParty,
        price_cents: i.priceCents,
        est_shipping_cents: i.estShippingCents,
        est_tax_cents: i.estTaxCents,
        est_total_cents: i.estTotalCents,
        handling_days_max: i.handlingDaysMax,
        delivery_days_min: i.deliveryDaysMin,
        delivery_days_max: i.deliveryDaysMax,
        arrive_by: i.arriveBy,
        reason: i.reason,
        over_budget: i.overBudget,
        rank: i.rank,
      }));
      const { data, error } = await concierge.rpc("save_ideas", { p_run_id: runId, p_ideas: rows });
      if (error) fail("Saving ideas failed", error);
      return data;
    },
  };
}
