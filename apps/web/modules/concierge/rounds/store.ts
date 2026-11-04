import "server-only";
import type {
  CalendarDate,
  OccasionKind,
  OccasionRule,
  RoundStatus,
  ScheduleSettings,
  StepKey,
} from "@gifts-af/core";
import { isShippableAddress } from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
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
};

/** What the round's emails say. Read with the service role; never logged. */
export type RoundContext = {
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
  /** null when the round isn't due, is finished, or another run holds it. */
  claim(roundId: string, now: Date): Promise<ClaimedRound | null>;
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
}

const SCHEDULE_KEYS: Record<keyof ScheduleSettings, string> = {
  planningDeliveryDays: "planning_delivery_days",
  safetyBufferDays: "safety_buffer_days",
  roundLeadDays: "round_lead_days",
  reminder1AfterHeadsUpDays: "reminder_1_after_heads_up_days",
  reminder2BeforeDeadlineDays: "reminder_2_before_deadline_days",
  finalNoticeBeforeDeadlineDays: "final_notice_before_deadline_days",
  fastestDaysToArrive: "fastest_days_to_arrive",
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


export function createSupabaseRoundStore(): RoundStore {
  const db = createAdminClient();
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

    async claim(roundId, now) {
      const { data, error } = await concierge.rpc("claim_round", {
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
        .select("person_id, occasion_id, occasion_date, ship_by_deadline")
        .eq("id", roundId)
        .single();
      if (error) fail("Loading the round failed", error);

      const [person, occasion, ideas] = await Promise.all([
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
      ]);
      if (person.error) fail("Loading the round's person failed", person.error);
      if (occasion.error) fail("Loading the round's occasion failed", occasion.error);
      if (ideas.error) fail("Loading the round's ideas failed", ideas.error);

      // A bonus in the email: failing to count them mustn't hold up a gift reminder.
      const open = await getOpenQuestions(db, round.person_id).catch((err: unknown) => {
        const error = err instanceof Error ? err.name : "unknown";
        logEvent("round_questions_failed", { round_id: roundId, person_id: round.person_id, error });
        return [];
      });

      const p = person.data;
      return {
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
  };
}
