// What the round engine creates and does next (ALL-28). Pure: the engine
// passes in today's date, the round's state and the schedule settings (T23).

import { compareDates, parseDate, type CalendarDate } from "./dates";
import { nextOccurrence, type OccasionRule } from "./occasions";
import type { RoundStatus } from "./rounds";
import { planRoundStart, reminderSchedule, type ReminderKind, type ScheduleSettings } from "./schedule";

export type StepKey =
  | "heads_up"
  | "reminder_1"
  | "reminder_2"
  | "final_notice"
  | "skipped"
  | "address_request"
  | "address_reminder_1"
  | "address_reminder_2"
  | "address_final_notice";

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
};

export type NextAction =
  | { do: "request_address"; send: "address_request" } // scheduled, no address → needs_address
  | { do: "generate" } // scheduled with address, or needs_address now has one → generating
  | { do: "send"; send: StepKey } // a reminder due today
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
  const skip = entries[entries.length - 1];
  if (compareDates(skip.date, today) <= 0) return { do: "skip", send: "skipped" };
  const pending = entries.filter((e) => !r.sent.has(e.key));
  const overdue = pending.filter((e) => compareDates(e.date, today) <= 0);
  // After a missed tick only the latest overdue reminder goes out; older ones are dropped.
  if (overdue.length > 0) return { do: "send", send: overdue[overdue.length - 1].key };
  return { do: "wait", until: (pending[0] ?? skip).date };
}

/**
 * Statuses the engine doesn't act on (ordered, delivered, complete, skipped)
 * return `wait` until the deadline, so a caller never has to special-case them.
 */
export function nextAction(r: RoundView, today: CalendarDate, s: ScheduleSettings): NextAction {
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
      return compareDates(r.shipByDeadline, today) <= 0
        ? { do: "skip", send: "skipped" }
        : { do: "wait", until: r.shipByDeadline };
    default:
      return { do: "wait", until: r.shipByDeadline };
  }
}
