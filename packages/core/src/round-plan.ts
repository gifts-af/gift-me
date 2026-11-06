// What the round engine creates and does next (ALL-28). Pure: the engine
// passes in today's date, the round's state and the schedule settings (T23).

import { addDays, compareDates, parseDate, type CalendarDate } from "./dates";
import { nextOccurrence, type OccasionRule } from "./occasions";
import type { RoundStatus } from "./rounds";
import { checkSettings, planRoundStart, reminderSchedule, type ReminderKind, type ScheduleSettings } from "./schedule";

export type StepKey =
  | "heads_up"
  | "reminder_1"
  | "reminder_2"
  | "final_notice"
  | "skipped"
  | "address_request"
  | "address_reminder_1"
  | "address_reminder_2"
  | "address_final_notice"
  // A held round's emails; `deadline` is the "still confirming" email for an unconfirmed order.
  | `hold:${number}:${"notice" | "reminder" | "final" | "deadline"}`
  | `hold:${number}:short:${string}`
  // Once per round: the store is still unreachable on the final hold day.
  | "hold_trouble"
  // The n-th failed order in the round (price_up, out_of_stock, too_late, failed), told at once.
  | `fail:${number}:notice`
  // The deadline email when our own switch (paused) kept the gift from going out.
  | "missed_on_us";

/** Why an order is held; `unconfirmed` is a round reason only. */
export type HoldReason = "funds" | "setup" | "address" | "paused" | "not_allowed" | "retry";
export type AttentionReason = HoldReason | "price_up" | "out_of_stock" | "too_late" | "failed" | "unconfirmed";

/** Holds the user is emailed about. */
export const EMAILED_HOLDS: readonly AttentionReason[] = ["funds", "setup", "address", "unconfirmed"];
/** Holds the engine keeps trying to place. `not_allowed` recovers by itself if paid features come back on. */
export const PLACEABLE_HOLDS: readonly AttentionReason[] = ["funds", "setup", "address", "paused", "not_allowed", "retry"];
/** Failed orders that need the buyer; each new one is emailed at once (`fail:<n>:notice`). */
export const FAILURE_REASONS: readonly AttentionReason[] = ["price_up", "out_of_stock", "too_late", "failed"];

export type NewRound = {
  occasionDate: CalendarDate;
  occasionYear: number;
  shipByDeadline: CalendarDate;
  late: boolean;
};

/** null = not due yet, or too late this year (planRoundStart null). */
export function roundToCreate(rule: OccasionRule, today: CalendarDate, s: ScheduleSettings): NewRound | null {
  const occasionDate = nextOccurrence(rule, today);
  const plan = planRoundStart(occasionDate, today, s);
  if (!plan || compareDates(plan.startDate, today) > 0) return null;
  return {
    occasionDate,
    occasionYear: parseDate(occasionDate).year,
    shipByDeadline: plan.deadline,
    late: plan.late,
  };
}

export type RoundView = {
  status: RoundStatus;
  shipByDeadline: CalendarDate;
  headsUpOn: CalendarDate | null;
  hasAddress: boolean;
  sent: ReadonlySet<StepKey>;
  /** Why a `needs_attention` round needs attention; null for other statuses. */
  attentionReason: AttentionReason | null;
  /** How many times the round has gone on hold; numbers the hold emails. */
  holdCount: number;
  /** How many of the round's orders have failed (not counting a bad address, which is held instead); numbers the failure emails. */
  failCount: number;
  /** The wallet balance the last check saw. */
  seenBalanceCents: number | null;
  /** The wallet balance the user was last emailed about. */
  emailedBalanceCents: number | null;
  /** This run already tried placing the round's held gifts; the reminders come after the try. */
  placeTried: boolean;
};

export type NextAction =
  | { do: "request_address"; send: "address_request" } // scheduled, no address → needs_address
  | { do: "generate" } // scheduled with address, or needs_address now has one → generating
  | { do: "send"; send: StepKey } // a reminder due today
  | { do: "place" } // a hold the engine can retry placing
  | { do: "send_hold"; send: StepKey; shortfall?: true } // a hold email due today
  | { do: "skip"; send: "skipped" } // deadline reached → skipped
  | { do: "wait"; until: CalendarDate }; // nothing due; next due day

const APPROVAL_KEYS: Record<ReminderKind, StepKey> = {
  reminder_1: "reminder_1",
  reminder_2: "reminder_2",
  final_notice: "final_notice",
  skip: "skipped",
};

const ADDRESS_KEYS: Record<ReminderKind, StepKey> = {
  reminder_1: "address_reminder_1",
  reminder_2: "address_reminder_2",
  final_notice: "address_final_notice",
  skip: "skipped",
};

function dueFromSchedule(
  r: RoundView,
  today: CalendarDate,
  s: ScheduleSettings,
  keys: Record<ReminderKind, StepKey>,
): NextAction {
  if (!r.headsUpOn) throw new RangeError(`A ${r.status} round needs the day its first message went out`);
  const entries = reminderSchedule(r.shipByDeadline, r.headsUpOn, s).map((e) => ({ key: keys[e.kind], date: e.date }));
  const due = entries.filter((e) => compareDates(e.date, today) <= 0);
  // Only the latest due step matters: older ones are dropped after a missed tick,
  // and are never sent once a later one has gone out.
  const latest = due[due.length - 1];
  if (latest && !r.sent.has(latest.key)) return { do: "send", send: latest.key };
  return { do: "wait", until: entries[due.length].date };
}

function holdAction(r: RoundView, today: CalendarDate, s: ScheduleSettings): NextAction {
  checkSettings(s);
  const reason = r.attentionReason;
  const wait: NextAction = { do: "wait", until: r.shipByDeadline };
  if (!reason) return wait;

  // A failure is told once, at once; then the buyer decides (or the deadline skips it).
  if (FAILURE_REASONS.includes(reason)) {
    const notice: StepKey = `fail:${r.failCount}:notice`;
    return r.sent.has(notice) ? wait : { do: "send_hold", send: notice };
  }

  const n = r.holdCount;
  const emailed = EMAILED_HOLDS.includes(reason);
  // A new hold is told before anything else.
  if (emailed) {
    const notice: StepKey = `hold:${n}:notice`;
    if (!r.sent.has(notice)) return { do: "send_hold", send: notice };
  }
  // Then one try at placing, so a gift that can now be bought never gets a "top up" email first.
  if (PLACEABLE_HOLDS.includes(reason) && !r.placeTried) return { do: "place" };

  const finalDue = compareDates(addDays(r.shipByDeadline, -s.holdFinalDays), today) <= 0;
  if (reason === "retry") {
    // Zinc has been down all along: told once, on the final hold day (owner, 2026-11-06).
    return finalDue && !r.sent.has("hold_trouble") ? { do: "send_hold", send: "hold_trouble" } : wait;
  }
  // `unconfirmed` gets its notice now and one more email at the deadline, never reminders.
  if (!emailed || reason === "unconfirmed") return wait;

  if (reason === "funds" && r.seenBalanceCents !== null && r.emailedBalanceCents !== null && r.seenBalanceCents > r.emailedBalanceCents) {
    // A partial top-up: the new shortfall, at most once a day (AC-22).
    const short: StepKey = `hold:${n}:short:${today}`;
    if (!r.sent.has(short)) return { do: "send_hold", send: short, shortfall: true };
  }
  // Like the approval reminders, only the latest due step is sent.
  const reminder: StepKey = `hold:${n}:reminder`;
  const final: StepKey = `hold:${n}:final`;
  const reminderDue = compareDates(addDays(r.shipByDeadline, -s.holdReminderDays), today) <= 0;
  if (finalDue) {
    if (!r.sent.has(final)) return { do: "send_hold", send: final };
  } else if (reminderDue && !r.sent.has(reminder)) {
    return { do: "send_hold", send: reminder };
  }
  return wait;
}

/**
 * Statuses the engine doesn't act on (ordered, delivered, complete, skipped)
 * return `wait` until the deadline, so a caller never has to special-case them.
 */
export function nextAction(r: RoundView, today: CalendarDate, s: ScheduleSettings): NextAction {
  const actionable = ["scheduled", "generating", "awaiting_approval", "needs_address", "needs_attention"];
  // The deadline skip comes first, so a stuck round still ends on time.
  if (actionable.includes(r.status) && compareDates(r.shipByDeadline, today) <= 0) {
    return { do: "skip", send: "skipped" };
  }
  switch (r.status) {
    case "scheduled":
      return r.hasAddress ? { do: "generate" } : { do: "request_address", send: "address_request" };
    case "generating":
      return { do: "generate" };
    case "awaiting_approval":
      return dueFromSchedule(r, today, s, APPROVAL_KEYS);
    case "needs_address":
      return r.hasAddress ? { do: "generate" } : dueFromSchedule(r, today, s, ADDRESS_KEYS);
    case "needs_attention":
      return holdAction(r, today, s);
    default: // the statuses we never act on
      return { do: "wait", until: r.shipByDeadline };
  }
}
