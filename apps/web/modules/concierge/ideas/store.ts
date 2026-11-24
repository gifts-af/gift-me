import "server-only";
import type { CalendarDate, OccasionKind, OccasionRule, ScheduleSettings } from "@gifts-af/core";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hasPaidFeatures } from "../paid-features";
import { activeFacts, type ActiveFact } from "../profile/profile";

// Everything one idea run needs from the database (ALL-27). runIdeas works on
// this interface, so its tests use an in-memory store; this file is thin glue
// on the service-role client (the server writes runs and ideas, T26). Limits,
// leases and saving live in SQL (migration 20261117100000_idea_engine).

export type AdminDb = ReturnType<typeof createAdminClient>;

export type IdeaRefusal = "not_found" | "not_paid" | "done" | "busy" | "limit" | "daily_limit" | "closed";

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
  /** The most Zinc lookups of list gifts in one run (ALL-29). */
  listLookupsMax: number;
  /** With fewer list gifts than this qualifying, the brainstorm adds ideas. */
  listMin: number;
  schedule: ScheduleSettings;
};

/** A gift on the person's linked list that may be offered (ALL-29, AC-27). Its name is the list owner's words: never sent to the AI (T42). */
export type ListGift = {
  itemId: string;
  name: string;
  url: string;
  asin: string | null;
  /** The list's own price; null when it has none. */
  listPriceCents: number | null;
};

/** What a run knows about the person, before any choice of occasion or budget. */
export type IdeaInputs = {
  /** The stored relationship, e.g. "father". */
  relationship: string;
  /** Each word of the person's and the buyer's names, longest first. Never logged. */
  names: string[];
  facts: ActiveFact[];
  /** Amazon product ids given, rejected as AI ideas, or already offered from the list in this round (excluded_offers). */
  excluded: string[];
  /** Titles of those ideas, so the AI doesn't suggest them again. Never a list gift's title (T42). */
  avoidTitles: string[];
  overBudgetPct: number;
  /**
   * A round's own occasion, date, deadline and budget; null on demand. `maxTotalCents`: the lowest
   * total among the round's AI ideas rejected as "Too pricey" (a list gift never sets it), else null.
   */
  round: {
    occasion: OccasionKind;
    occasionDate: CalendarDate;
    shipByDeadline: CalendarDate;
    budgetCents: number | null;
    maxTotalCents: number | null;
  } | null;
  /** On demand: the person's enabled occasions, each with its own budget. */
  occasions: { rule: OccasionRule; ownBudgetCents: number | null }[];
  /** The person's base budget (a budgets row of kind 'any', T73). */
  baseBudgetCents: number | null;
  /** The buyer's default for this relationship. */
  defaultBudgetCents: number | null;
  /** Rounds only: the linked list's offerable gifts, in list order (listGiftCandidates). Empty on demand. */
  listGifts: ListGift[];
};

/**
 * One idea to save, every price and day from a live Zinc offer (AC-2). A list gift Zinc can only
 * check has the list's price, no product id, and planning_delivery_days as its delivery (AC-27).
 */
export type SavedIdea = {
  title: string;
  retailer: string;
  productUrl: string;
  retailerProductId: string | null;
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
  /** Zinc's photo, https only (AC-17); null without one. */
  imageUrl: string | null;
  source: "generated" | "list";
  /** The list gift, for source "list". */
  listItemId: string | null;
};

export type RunStage = "brainstormed" | "resolved" | "ranked";
/** How a run ends: idea_runs.outcome's CHECK list. `no_credit` (the AI credit ran out) doesn't count as a run. */
export const RUN_ENDS = ["saved", "none", "failed", "cost_cap", "deadline", "no_credit"] as const;
export type RunEnd = (typeof RUN_ENDS)[number];

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
  /** How many were saved; -1 when the round ended during the run, so none were. */
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
  listLookupsMax: "idea_list_lookups_max",
  listMin: "idea_list_min",
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

// Database replies are checked where they come in (E4). Any excluded_offers column can be null,
// whatever the generated types say.
const excludedOffer = z.object({ retailer: z.string().nullable(), product_id: z.string().nullable(), list_item_id: z.string().nullable() });
type ExcludedOffer = z.infer<typeof excludedOffer>;
const personList = z.object({ items: z.array(z.unknown()) }).nullable();
const personListItem = z.object({
  id: z.string(),
  name: z.string(),
  price_cents: z.number().int().nullable(),
  product_url: z.string().nullable(),
  asin: z.string().nullable(),
  claimed: z.boolean(),
});

/** excluded_offers for a run in roundId (null on demand). */
async function excludedOffers(db: AdminDb, personId: string, roundId: string | null): Promise<ExcludedOffer[]> {
  const { data, error } = await db
    .schema("concierge")
    // PostgREST takes null for a uuid argument; the generated type says string.
    .rpc("excluded_offers", { p_person_id: personId, p_round_id: roundId as string });
  if (error) fail("Loading excluded offers failed", error);
  return z.array(excludedOffer).parse(data);
}

/** The products the brainstorm mustn't offer again. Its ideas are all Amazon's; a row saved without a retailer counts as Amazon. */
function excludedAmazonIds(rows: ExcludedOffer[]): string[] {
  const ids = rows
    .filter((r) => r.product_id !== null && (r.retailer === null || r.retailer.toLowerCase() === "amazon"))
    .map((r) => r.product_id as string);
  return [...new Set(ids)];
}

async function offerableListGifts(db: AdminDb, personId: string, excluded: ExcludedOffer[]): Promise<ListGift[]> {
  const { data, error } = await db.schema("lists").rpc("person_list", { p_person_id: personId });
  // A person removed since the round began has no list to offer.
  if (error?.code === "P0002") return [];
  if (error) fail("Loading the person's list failed", error);
  const list = personList.parse(data);
  if (list === null) return [];
  const gone = new Set(excluded.map((r) => r.list_item_id).filter((id) => id !== null));
  const out: ListGift[] = [];
  for (const raw of list.items) {
    const p = personListItem.safeParse(raw);
    // A gift without a link can't be priced or bought; a claimed or given one, or one this round
    // already offered, isn't offered (AC-31).
    if (!p.success || p.data.claimed || p.data.product_url === null || gone.has(p.data.id)) continue;
    const i = p.data;
    out.push({
      itemId: i.id,
      name: i.name,
      url: i.product_url as string,
      asin: i.asin,
      // The lists product saves 0 when it knows no price.
      listPriceCents: i.price_cents !== null && i.price_cents > 0 ? i.price_cents : null,
    });
  }
  return out;
}

/**
 * The one read of offerable list gifts (S6), for a run in roundId, roundContext and the rejection
 * outlook: the person's linked list through lists.person_list (service role, T19), unclaimed, in
 * list order, without the ones excluded_offers names: given, or already offered in this round. A
 * list gift rejected in another round is offered again (AC-31, owner 2026-11-22).
 */
export async function listGiftCandidates(db: AdminDb, personId: string, roundId: string | null): Promise<ListGift[]> {
  return offerableListGifts(db, personId, await excludedOffers(db, personId, roundId));
}

/** The lowest total among the round's AI ideas rejected as "Too pricey"; list gifts never set it. */
async function roundCeiling(db: AdminDb, roundId: string): Promise<number | null> {
  const concierge = db.schema("concierge");
  const { data: rejected, error } = await concierge
    .from("rejections")
    .select("idea_id")
    .eq("round_id", roundId)
    .eq("reason_code", "too_pricey")
    .not("idea_id", "is", null);
  if (error) fail("Loading the round's rejections failed", error);
  const ids = rejected.map((r) => r.idea_id).filter((id): id is string => id !== null);
  if (ids.length === 0) return null;
  const { data: cheapest, error: ideaError } = await concierge
    .from("gift_ideas")
    .select("est_total_cents")
    .in("id", ids)
    .eq("source", "generated")
    .order("est_total_cents", { ascending: true })
    .limit(1);
  if (ideaError) fail("Loading the rejected ideas failed", ideaError);
  return cheapest[0]?.est_total_cents ?? null;
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
          maxTotalCents: await roundCeiling(db, roundId),
        };
      }

      const [buyer, facts, excludedRows, account, occasions, budgets, byDefault] = await Promise.all([
        db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
        activeFacts(db, personId),
        excludedOffers(db, personId, roundId),
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
      if (account.error) fail("Loading the account failed", account.error);
      if (!account.data) throw new Error("The buyer has no account row.");
      if (occasions.error) fail("Loading occasions failed", occasions.error);
      if (budgets.error) fail("Loading budgets failed", budgets.error);
      if (byDefault.error) fail("Loading the default budget failed", byDefault.error);

      const excluded = excludedAmazonIds(excludedRows);
      // Rounds only: on demand offers no list gifts.
      const listGifts = round ? await offerableListGifts(db, personId, excludedRows) : [];
      let avoidTitles: string[] = [];
      if (excluded.length > 0) {
        // This person's ideas only (T42: another person's title may hold their name). Ideas
        // saved before person_id existed belong to the person through their round, as in
        // excluded_products.
        const { data: rounds, error: roundsError } = await concierge
          .from("gift_rounds")
          .select("id")
          .eq("user_id", userId)
          .eq("person_id", personId);
        if (roundsError) fail("Loading the person's rounds failed", roundsError);
        const owner = [`person_id.eq.${personId}`];
        if (rounds.length > 0) owner.push(`and(person_id.is.null,round_id.in.(${rounds.map((r) => r.id).join(",")}))`);
        const { data: titles, error: titleError } = await concierge
          .from("gift_ideas")
          .select("title")
          .eq("user_id", userId)
          // A list gift's title is the list owner's words: never sent to the AI (T42).
          .eq("source", "generated")
          .in("retailer_product_id", excluded)
          .or(owner.join(","));
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
        listGifts,
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
        image_url: i.imageUrl,
        source: i.source,
        list_item_id: i.listItemId,
      }));
      const { data, error } = await concierge.rpc("save_ideas", { p_run_id: runId, p_ideas: rows });
      if (error) fail("Saving ideas failed", error);
      return data;
    },
  };
}
