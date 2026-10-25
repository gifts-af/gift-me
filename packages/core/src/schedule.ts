// Ship-by deadline and reminder schedule (design §4.1, PRD D23). The timings
// are settings, not constants (T23): callers read them from
// `concierge.app_settings` and pass them in.

import { addDays, compareDates, maxDate, type CalendarDate } from "./dates";

export type ScheduleSettings = {
  /** Days to arrive assumed before any idea (and its real estimate) exists. */
  planningDeliveryDays: number;
  /** Days of margin kept between the slowest arrival and the occasion. */
  safetyBufferDays: number;
  /** How long before the planning deadline a round starts. */
  roundLeadDays: number;
  reminder1AfterHeadsUpDays: number;
  reminder2BeforeDeadlineDays: number;
  finalNoticeBeforeDeadlineDays: number;
  /** The fastest shipping a late round still hopes to find. */
  fastestDaysToArrive: number;
};

export type ReminderKind = "reminder_1" | "reminder_2" | "final_notice" | "skip";

function checkDays(days: number, what: string): void {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`${what} must be a whole number of days, 0 or more; got ${days}`);
  }
}

function checkSettings(s: ScheduleSettings): void {
  for (const [what, days] of Object.entries(s)) checkDays(days, what);
}

/**
 * The last day an order can be placed and still arrive, with the buffer.
 * `worstCaseDaysToArrive` is the slowest handling plus delivery, not
 * delivery alone; it defaults to the planning value.
 */
export function shipByDeadline(
  occasionDate: CalendarDate,
  s: ScheduleSettings,
  worstCaseDaysToArrive: number = s.planningDeliveryDays,
): CalendarDate {
  checkSettings(s);
  checkDays(worstCaseDaysToArrive, "Days to arrive");
  return addDays(occasionDate, -(worstCaseDaysToArrive + s.safetyBufferDays));
}

/** When a round normally starts: the lead time before the planning deadline. */
export function roundStartDate(occasionDate: CalendarDate, s: ScheduleSettings): CalendarDate {
  return addDays(shipByDeadline(occasionDate, s), -s.roundLeadDays);
}

/**
 * A round never starts in the past. If today is already after the normal
 * start (a person added close to their birthday), it starts today and is
 * marked late so the heads-up can say so.
 *
 * If the planning deadline has already arrived, the deadline moves to the
 * last day the fastest shipping could still make it, and the idea filter
 * keeps only ideas fast enough for that. Once ideas exist, the chosen idea's
 * real deadline replaces it. The deadline always leaves at least one day to
 * answer, because the round is skipped on the morning of its deadline.
 * `null` means even the fastest shipping can't make it this year.
 */
export function planRoundStart(
  occasionDate: CalendarDate,
  today: CalendarDate,
  s: ScheduleSettings,
): { startDate: CalendarDate; deadline: CalendarDate; late: boolean } | null {
  const normalStart = roundStartDate(occasionDate, s);
  const planningDeadline = shipByDeadline(occasionDate, s);
  const deadline =
    compareDates(planningDeadline, today) > 0
      ? planningDeadline
      : shipByDeadline(occasionDate, s, s.fastestDaysToArrive);
  if (compareDates(deadline, today) <= 0) return null;
  return {
    startDate: maxDate(today, normalStart),
    deadline,
    late: compareDates(today, normalStart) > 0,
  };
}

/**
 * The reminders still worth sending after the heads-up, in date order, ending
 * with the skip at the deadline. A late heads-up compresses the schedule:
 * reminders on or before the heads-up (or on or after the deadline) are
 * dropped, and reminder 1 is dropped if it would land on or after reminder 2.
 */
export function reminderSchedule(
  deadline: CalendarDate,
  headsUpDate: CalendarDate,
  s: ScheduleSettings,
): { kind: ReminderKind; date: CalendarDate }[] {
  checkSettings(s);
  if (compareDates(headsUpDate, deadline) >= 0) {
    // planRoundStart never gives a deadline this close; a skip in the past would end the round unseen.
    throw new RangeError(`Heads-up ${headsUpDate} must come before the deadline ${deadline}`);
  }
  const reminder2 = addDays(deadline, -s.reminder2BeforeDeadlineDays);
  const candidates: { kind: ReminderKind; date: CalendarDate }[] = [
    { kind: "reminder_1", date: addDays(headsUpDate, s.reminder1AfterHeadsUpDays) },
    { kind: "reminder_2", date: reminder2 },
    { kind: "final_notice", date: addDays(deadline, -s.finalNoticeBeforeDeadlineDays) },
  ];
  const kept = candidates.filter(
    (r) =>
      compareDates(r.date, headsUpDate) > 0 &&
      compareDates(r.date, deadline) < 0 &&
      !(r.kind === "reminder_1" && compareDates(r.date, reminder2) >= 0),
  );
  return [...kept, { kind: "skip", date: deadline }];
}

/**
 * The slowest-case arrival date for an order placed on `orderDate`. Days are
 * calendar days; the slowest case plus the deadline buffer covers weekends.
 */
export function arriveBy(
  orderDate: CalendarDate,
  handlingDaysMax: number,
  deliveryDaysMax: number,
): CalendarDate {
  checkDays(handlingDaysMax, "Handling days");
  checkDays(deliveryDaysMax, "Delivery days");
  return addDays(orderDate, handlingDaysMax + deliveryDaysMax);
}

/**
 * An idea is still worth offering if, ordered on `orderDate`, its slowest
 * case arrives with the full safety buffer to spare. Pass the latest date
 * the user might order (the round's deadline), not the day ideas are made,
 * so a user who approves late still gets the gift in time.
 */
export function canArriveInTime(
  p: { occasionDate: CalendarDate; orderDate: CalendarDate; handlingDaysMax: number; deliveryDaysMax: number },
  s: ScheduleSettings,
): boolean {
  checkSettings(s);
  const arrives = arriveBy(p.orderDate, p.handlingDaysMax, p.deliveryDaysMax);
  return compareDates(arrives, addDays(p.occasionDate, -s.safetyBufferDays)) <= 0;
}
