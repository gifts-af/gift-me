import "server-only";
import type {
  AttentionReason,
  CalendarDate,
  Database,
  OccasionKind,
  OccasionRule,
  RoundStatus,
  ScheduleSettings,
  StepKey,
} from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isShippableAddress } from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPaidFeatures } from "../paid-features";
import { getOpenQuestions } from "../profile/profile";

// Everything the round engine needs from the database (ALL-28). The interface
// keeps engine.ts testable with an in-memory store; the Supabase version below
// is thin glue on the server-only admin client (T26: the server writes rounds).
// Claims, leases and send records live in SQL (migration 20261105100000).

/** An enabled occasion of a live person, with its budget resolved. */
export type Candidate = {
  userId: string;
  personId: string;
  occasionId: string;
  rule: OccasionRule;
  budgetCents: number | null;
};

export type NewRoundRow = {
  userId: string;
  personId: string;
  occasionId: string;
  occasionYear: number;
  occasionDate: CalendarDate;
  shipByDeadline: CalendarDate;
  budgetCents: number | null;
  late: boolean;
  nextActionAt: Date;
};

/** A round leased to this run until `lockedUntil`, which is also the lease token for `finish`. */
export type ClaimedRound = {
  id: string;
  userId: string;
  personId: string;
  status: RoundStatus;
  shipByDeadline: CalendarDate;
  headsUpOn: CalendarDate | null;
  late: boolean;
  attempts: number;
  lockedUntil: Date;
  /** The money-path fields reconcile_round keeps (ALL-32); null and 0 off the money path. */
  attentionReason: AttentionReason | null;
  holdCount: number;
  seenBalanceCents: number | null;
  emailedBalanceCents: number | null;
};

/** One of the round's orders, for the hold and failure emails (ALL-32). */
export type RoundOrder = {
  id: string;
  title: string;
  /** Where it ships, city only (never the full address); null when unknown. */
  shipCity: string | null;
  status: string;
  holdReason: string | null;
  failureType: string | null;
  resolved: boolean;
  /** It failed after the round closed: emailed once as `late_fail:<id>` (failed_late). */
  failedAfterClose: boolean;
  maxPriceCents: number;
  feeCents: number;
};

/** What the round's emails say. Read with the service role; never logged. */
export type RoundContext = {
  userId: string;
  personId: string;
  personName: string;
  occasionKind: OccasionKind;
  occasionDate: CalendarDate;
  shipByDeadline: CalendarDate;
  hasAddress: boolean;
  /** Guided questions open for the person (ALL-26); the emails link them when above 0. */
  openQuestions: number;
  /** Proposed ideas, best first. */
  ideas: { title: string; totalCents: number }[];
  /** The round's orders, oldest first, with their idea's title (ALL-32). */
  orders: RoundOrder[];
  /** round_fail_count: numbers the failure emails (fail:<n>:notice). */
  failCount: number;
};

export type RoundFinish = {
  status: RoundStatus;
  nextActionAt: Date | null;
  /** Left as it was when omitted. */
  headsUpOn?: CalendarDate;
};

export interface RoundStore {
  setting(key: string): Promise<number>;
  /** The seven design §4.1 timings. */
  scheduleSettings(): Promise<ScheduleSettings>;
  candidates(today: CalendarDate): Promise<Candidate[]>;
  /** On conflict (person, occasion, year) does nothing; true if a row was inserted. */
  insertRound(r: NewRoundRow): Promise<boolean>;
  claimDue(now: Date): Promise<ClaimedRound[]>;
  /** claim_due_money_rounds: only the due rounds that need attention (a hold or a failure). */
  claimDueMoney(now: Date): Promise<ClaimedRound[]>;
  /** null when the round isn't due, is finished, or another run holds it. */
  claim(roundId: string, now: Date): Promise<ClaimedRound | null>;
  /**
   * claim_round_now: claims an awaiting_approval or needs_attention round whatever its
   * next_action_at (null when another run holds it). For telling the buyer at once after
   * placing: reconcile_round makes the round due at the database's now(), which is later
   * than the caller's `now`, so `claim` would say "not due yet".
   */
  claimNow(roundId: string, now: Date): Promise<ClaimedRound | null>;
  /** Writes the result and releases the lease; false if the lease was lost. */
  finish(roundId: string, lock: Date, next: RoundFinish): Promise<boolean>;
  sentSteps(roundId: string): Promise<Set<StepKey>>;
  /** false = already recorded, so the email must not go out again. */
  recordSend(roundId: string, userId: string, step: StepKey): Promise<boolean>;
  forgetSend(roundId: string, step: StepKey): Promise<void>;
  roundContext(roundId: string): Promise<RoundContext>;
  /**
   * The person's `needs_address` rounds, made due at `now` so they can be
   * claimed straight away (their next reminder may be days ahead).
   */
  waitingRoundsForPerson(personId: string, now: Date): Promise<string[]>;

  // ─── The money path (ALL-32): reconcile_round owns these rounds' status, never finish. ───
  /** The round's fields as they are now, keeping the lease. */
  refresh(round: ClaimedRound): Promise<ClaimedRound>;
  reconcile(roundId: string): Promise<RoundStatus | null>;
  /** Gives the lease back; false if it was lost. */
  release(roundId: string, lock: Date): Promise<boolean>;
  /** The deadline: held orders cancelled, failures resolved; returns the status it settles on. */
  cancelHeld(roundId: string): Promise<RoundStatus | null>;
  /** After a hold email: the reason it told (reconcile rule 4) and the balance it named (AC-22). */
  markHoldEmailed(roundId: string, reason: AttentionReason, balanceCents: number | null): Promise<void>;
  /** Paid features on and Zinc connected: only then is the wallet read (AC-11). */
  canBuy(userId: string): Promise<boolean>;
  /**
   * Rounds still open or ordered with a placed order whose `ordered:<id>` email isn't recorded,
   * and rounds (any status) with an order that failed after the round closed whose
   * `late_fail:<id>` email isn't recorded.
   */
  roundsMissingOrderedEmail(): Promise<string[]>;
}

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

type RoundDbRow = {
  id: string | null;
  user_id: string;
  person_id: string;
  status: RoundStatus;
  ship_by_deadline: string;
  heads_up_on: string | null;
  late: boolean;
  attempts: number;
  locked_until: string | null;
  attention_reason?: string | null;
  hold_count?: number | null;
  seen_balance_cents?: number | null;
  emailed_balance_cents?: number | null;
};

// claim_round returns NULL as a row of nulls through PostgREST: no id means not claimed.
function toClaimed(r: RoundDbRow | null): ClaimedRound | null {
  if (!r?.id || !r.locked_until) return null;
  return {
    id: r.id,
    userId: r.user_id,
    personId: r.person_id,
    status: r.status,
    shipByDeadline: r.ship_by_deadline,
    headsUpOn: r.heads_up_on,
    late: r.late,
    attempts: r.attempts,
    // Postgres returns the lease with millisecond precision (it is now + whole
    // minutes, and now came from a JS Date), so this Date round-trips exactly.
    lockedUntil: new Date(r.locked_until),
    attentionReason: (r.attention_reason ?? null) as AttentionReason | null,
    holdCount: r.hold_count ?? 0,
    seenBalanceCents: r.seen_balance_cents ?? null,
    emailedBalanceCents: r.emailed_balance_cents ?? null,
  };
}

function toRule(kind: string, month: number | null, day: number | null): OccasionRule {
  if (kind === "birthday" || kind === "anniversary") {
    if (month === null || day === null) throw new Error(`A ${kind} occasion has no date`);
    return { kind, month, day };
  }
  return { kind: kind as Exclude<OccasionKind, "birthday" | "anniversary"> };
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}


/** The service-role client; tests pass one for the local database (E3). */
export function createSupabaseRoundStore(db: SupabaseClient<Database> = createAdminClient()): RoundStore {
  const concierge = db.schema("concierge");

  async function setting(key: string): Promise<number> {
    const { data, error } = await concierge.rpc("setting_int", { p_key: key });
    if (error) fail(`Reading setting ${key} failed`, error);
    if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
    return data;
  }

  return {
    setting,

    async scheduleSettings() {
      const keys = Object.keys(SCHEDULE_KEYS) as (keyof ScheduleSettings)[];
      const values = await Promise.all(keys.map((k) => setting(SCHEDULE_KEYS[k])));
      return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as ScheduleSettings;
    },

    async candidates(today) {
      const { data, error } = await concierge.rpc("round_candidates", { p_today: today });
      if (error) fail("Loading round candidates failed", error);
      return data.map((r) => ({
        userId: r.user_id,
        personId: r.person_id,
        occasionId: r.occasion_id,
        rule: toRule(r.kind, r.month, r.day),
        budgetCents: r.budget_cents ?? null,
      }));
    },

    async insertRound(r) {
      const { data, error } = await concierge
        .from("gift_rounds")
        .upsert(
          {
            user_id: r.userId,
            person_id: r.personId,
            occasion_id: r.occasionId,
            occasion_year: r.occasionYear,
            occasion_date: r.occasionDate,
            ship_by_deadline: r.shipByDeadline,
            budget_cents: r.budgetCents,
            late: r.late,
            status: "scheduled",
            next_action_at: r.nextActionAt.toISOString(),
          },
          { onConflict: "person_id,occasion_id,occasion_year", ignoreDuplicates: true },
        )
        .select("id");
      if (error) fail("Creating the round failed", error);
      return data.length > 0;
    },

    async claimDue(now) {
      const { data, error } = await concierge.rpc("claim_due_rounds", { p_now: now.toISOString() });
      if (error) fail("Claiming due rounds failed", error);
      return data.map(toClaimed).filter((r): r is ClaimedRound => r !== null);
    },

    async claimDueMoney(now) {
      const { data, error } = await concierge.rpc("claim_due_money_rounds", { p_now: now.toISOString() });
      if (error) fail("Claiming due money-path rounds failed", error);
      return data.map(toClaimed).filter((r): r is ClaimedRound => r !== null);
    },

    async claim(roundId, now) {
      const { data, error } = await concierge.rpc("claim_round", {
        p_round_id: roundId,
        p_now: now.toISOString(),
      });
      if (error) fail("Claiming the round failed", error);
      return toClaimed(data as RoundDbRow | null);
    },

    async claimNow(roundId, now) {
      const { data, error } = await concierge.rpc("claim_round_now", {
        p_round_id: roundId,
        p_now: now.toISOString(),
      });
      if (error) fail("Claiming the round failed", error);
      return toClaimed(data as RoundDbRow | null);
    },

    async finish(roundId, lock, next) {
      const { data, error } = await concierge.rpc("finish_round", {
        p_round_id: roundId,
        p_lock: lock.toISOString(),
        p_status: next.status,
        // The generated types say string, but both arguments take SQL null.
        p_next_action_at: (next.nextActionAt?.toISOString() ?? null) as string,
        p_heads_up_on: (next.headsUpOn ?? null) as string,
      });
      if (error) fail("Finishing the round failed", error);
      return data === true;
    },

    async sentSteps(roundId) {
      const { data, error } = await concierge.from("round_sends").select("step").eq("round_id", roundId);
      if (error) fail("Loading the round's sends failed", error);
      return new Set(data.map((r) => r.step as StepKey));
    },

    async recordSend(roundId, userId, step) {
      const { data, error } = await concierge
        .from("round_sends")
        .upsert(
          { round_id: roundId, user_id: userId, step },
          { onConflict: "round_id,step", ignoreDuplicates: true },
        )
        .select("step");
      if (error) fail("Recording the send failed", error);
      return data.length > 0;
    },

    async forgetSend(roundId, step) {
      const { error } = await concierge.from("round_sends").delete().eq("round_id", roundId).eq("step", step);
      if (error) fail("Forgetting the send failed", error);
    },

    async roundContext(roundId) {
      const { data: round, error } = await concierge
        .from("gift_rounds")
        .select("user_id, person_id, occasion_id, occasion_date, ship_by_deadline")
        .eq("id", roundId)
        .single();
      if (error) fail("Loading the round failed", error);

      const [person, occasion, ideas, orders, failCount] = await Promise.all([
        db
          .from("people")
          .select("name, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country")
          .eq("id", round.person_id)
          .single(),
        concierge.from("occasions").select("kind").eq("id", round.occasion_id).single(),
        concierge
          .from("gift_ideas")
          .select("title, est_total_cents")
          .eq("round_id", roundId)
          .eq("status", "proposed")
          .order("rank"),
        concierge
          .from("orders")
          .select("id, status, hold_reason, failure_type, resolved, failed_after_close, max_price_cents, fee_cents, ship_city, created_at, gift_ideas(title)")
          .eq("round_id", roundId)
          .order("created_at")
          .order("id"),
        concierge.rpc("round_fail_count", { p_round_id: roundId }),
      ]);
      if (person.error) fail("Loading the round's person failed", person.error);
      if (occasion.error) fail("Loading the round's occasion failed", occasion.error);
      if (ideas.error) fail("Loading the round's ideas failed", ideas.error);
      if (orders.error) fail("Loading the round's orders failed", orders.error);
      if (failCount.error) fail("Counting the round's failures failed", failCount.error);

      // A bonus in the email: failing to count them mustn't hold up a gift reminder.
      const open = await getOpenQuestions(db, round.person_id).catch((err: unknown) => {
        const error = err instanceof Error ? err.name : "unknown";
        logEvent("round_questions_failed", { round_id: roundId, person_id: round.person_id, error });
        return [];
      });

      const p = person.data;
      return {
        userId: round.user_id,
        personId: round.person_id,
        personName: p.name,
        occasionKind: occasion.data.kind as OccasionKind,
        occasionDate: round.occasion_date,
        shipByDeadline: round.ship_by_deadline,
        // The same format check as the address form (T51): an incomplete import still asks.
        hasAddress: isShippableAddress({
          firstName: p.recipient_first_name,
          lastName: p.recipient_last_name,
          line1: p.address_line1,
          line2: p.address_line2,
          city: p.city,
          state: p.state,
          zip: p.zip,
          country: p.country,
        }),
        openQuestions: open.length,
        ideas: ideas.data.map((i) => ({ title: i.title, totalCents: i.est_total_cents })),
        orders: orders.data.map((o) => ({
          id: o.id,
          title: (o.gift_ideas as { title: string } | null)?.title ?? "gift",
          shipCity: o.ship_city,
          status: o.status,
          holdReason: o.hold_reason,
          failureType: o.failure_type,
          resolved: o.resolved,
          failedAfterClose: o.failed_after_close,
          maxPriceCents: o.max_price_cents,
          feeCents: o.fee_cents,
        })),
        failCount: failCount.data ?? 0,
      };
    },

    async waitingRoundsForPerson(personId, now) {
      const { data, error } = await concierge
        .from("gift_rounds")
        .update({ next_action_at: now.toISOString() })
        .eq("person_id", personId)
        .eq("status", "needs_address")
        .select("id");
      if (error) fail("Loading the person's waiting rounds failed", error);
      return data.map((r) => r.id);
    },

    async refresh(round) {
      const { data, error } = await concierge
        .from("gift_rounds")
        .select("status, ship_by_deadline, heads_up_on, attention_reason, hold_count, seen_balance_cents, emailed_balance_cents")
        .eq("id", round.id)
        .single();
      if (error) fail("Reloading the round failed", error);
      return {
        ...round,
        status: data.status,
        shipByDeadline: data.ship_by_deadline,
        headsUpOn: data.heads_up_on,
        attentionReason: (data.attention_reason ?? null) as AttentionReason | null,
        holdCount: data.hold_count,
        seenBalanceCents: data.seen_balance_cents,
        emailedBalanceCents: data.emailed_balance_cents,
      };
    },

    async reconcile(roundId) {
      const { data, error } = await concierge.rpc("reconcile_round", { p_round_id: roundId });
      if (error) fail("Reconciling the round failed", error);
      return (data as RoundStatus | null) ?? null;
    },

    async release(roundId, lock) {
      const { data, error } = await concierge.rpc("release_round", { p_round_id: roundId, p_lock: lock.toISOString() });
      if (error) fail("Releasing the round failed", error);
      return data === true;
    },

    async cancelHeld(roundId) {
      const { data, error } = await concierge.rpc("cancel_held", { p_round_id: roundId, p_context: "deadline" });
      if (error) fail("Closing the round at its deadline failed", error);
      return (data as RoundStatus | null) ?? null;
    },

    async markHoldEmailed(roundId, reason, balanceCents) {
      const told = await concierge.rpc("set_last_emailed_reason", { p_round_id: roundId, p_reason: reason });
      if (told.error) fail("Saving the emailed reason failed", told.error);
      if (balanceCents === null) return;
      const balance = await concierge.rpc("set_emailed_balance", { p_round_id: roundId, p_cents: balanceCents });
      if (balance.error) fail("Saving the emailed balance failed", balance.error);
    },

    async roundsMissingOrderedEmail() {
      // Rounds with an order that failed after the round closed and whose email isn't recorded
      // (rounds_missing_late_failure_email: only the unsent ones, never every late failure ever).
      const lateFailures = async (): Promise<string[]> => {
        const { data, error: lateError } = await concierge.rpc("rounds_missing_late_failure_email");
        if (lateError) fail("Loading late failures failed", lateError);
        return (data ?? []) as string[];
      };
      // Bounded to rounds that aren't finished: ordered or still needing the buyer.
      // Follow-up (past MVP scale): one SQL query with NOT EXISTS on round_sends, or a recent window.
      const { data: orders, error } = await concierge
        .from("orders")
        .select("id, round_id, gift_rounds!inner(status)")
        .in("status", ["placed", "shipped", "delivered"])
        .in("gift_rounds.status", ["ordered", "needs_attention"]);
      if (error) fail("Loading placed orders failed", error);
      if (!orders.length) return lateFailures();
      const roundIds = [...new Set(orders.map((o) => o.round_id))];
      const { data: sends, error: sendsError } = await concierge
        .from("round_sends")
        .select("step")
        .in("round_id", roundIds)
        .like("step", "ordered:%");
      if (sendsError) fail("Loading the ordered emails failed", sendsError);
      const told = new Set(sends.map((s) => s.step));
      const late = await lateFailures();
      return [...new Set([...orders.filter((o) => !told.has(`ordered:${o.id}`)).map((o) => o.round_id), ...late])];
    },

    async canBuy(userId) {
      if (!(await hasPaidFeatures(db, userId))) return false;
      const { data, error } = await concierge.from("accounts").select("zinc_connected_at").eq("user_id", userId).maybeSingle();
      if (error) fail("Reading the account failed", error);
      return Boolean(data?.zinc_connected_at);
    },
  };
}
