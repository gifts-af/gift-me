// Ship-by deadline and reminder schedule (design §4.1, PRD D23). Tunable
// values are sensible defaults to adjust once real usage shows what's needed.

import { addDays, compareDates, maxDate, type CalendarDate } from "./dates";

/** Delivery days assumed before any idea (and its real estimate) exists. */
export const PLANNING_DELIVERY_DAYS = 7;
export const SAFETY_BUFFER_DAYS = 2;
export const ROUND_LEAD_DAYS = 28;
export const REMINDER_1_AFTER_HEADS_UP_DAYS = 5;
export const REMINDER_2_BEFORE_DEADLINE_DAYS = 7;
export const FINAL_NOTICE_BEFORE_DEADLINE_DAYS = 2;

export type ReminderKind = "reminder_1" | "reminder_2" | "final_notice" | "skip";

function checkDays(days: number, what: string): void {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`${what} must be a whole number of days, 0 or more; got ${days}`);
  }
}

/** The fastest shipping a late round still hopes to find (next-day delivery). */
export const FASTEST_DAYS_TO_ARRIVE = 1;

/**
 * The last day an order can be placed and still arrive, with the buffer.
 * `worstCaseDaysToArrive` is the slowest handling plus delivery, not
 * delivery alone.
 */
export function shipByDeadline(
  occasionDate: CalendarDate,
  worstCaseDaysToArrive: number = PLANNING_DELIVERY_DAYS,
): CalendarDate {
  checkDays(worstCaseDaysToArrive, "Days to arrive");
  return addDays(occasionDate, -(worstCaseDaysToArrive + SAFETY_BUFFER_DAYS));
}

/** When a round normally starts: 28 days before the planning deadline. */
export function roundStartDate(occasionDate: CalendarDate): CalendarDate {
  return addDays(shipByDeadline(occasionDate), -ROUND_LEAD_DAYS);
}

/**
 * A round never starts in the past. If today is already after the normal
 * start (a person added close to their birthday), it starts today and is
 * marked late so the heads-up can say so.
 *
 * If the planning deadline has already arrived, the deadline moves to the
 * last day next-day shipping could still make it, and the idea filter keeps
 * only ideas fast enough for that. Once ideas exist, the chosen idea's real
 * deadline replaces it. The deadline always leaves at least one day to
 * answer, because the round is skipped on the morning of its deadline.
 * `null` means even next-day shipping can't make it this year.
 */
export function planRoundStart(
  occasionDate: CalendarDate,
  today: CalendarDate,
): { startDate: CalendarDate; deadline: CalendarDate; late: boolean } | null {
  const normalStart = roundStartDate(occasionDate);
  const planningDeadline = shipByDeadline(occasionDate);
  const deadline =
    compareDates(planningDeadline, today) > 0
      ? planningDeadline
      : shipByDeadline(occasionDate, FASTEST_DAYS_TO_ARRIVE);
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
): { kind: ReminderKind; date: CalendarDate }[] {
  if (compareDates(headsUpDate, deadline) >= 0) {
    // planRoundStart never gives a deadline this close; a skip in the past would end the round unseen.
    throw new RangeError(`Heads-up ${headsUpDate} must come before the deadline ${deadline}`);
  }
  const reminder2 = addDays(deadline, -REMINDER_2_BEFORE_DEADLINE_DAYS);
  const candidates: { kind: ReminderKind; date: CalendarDate }[] = [
    { kind: "reminder_1", date: addDays(headsUpDate, REMINDER_1_AFTER_HEADS_UP_DAYS) },
    { kind: "reminder_2", date: reminder2 },
    { kind: "final_notice", date: addDays(deadline, -FINAL_NOTICE_BEFORE_DEADLINE_DAYS) },
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
export function canArriveInTime(p: {
  occasionDate: CalendarDate;
  orderDate: CalendarDate;
  handlingDaysMax: number;
  deliveryDaysMax: number;
}): boolean {
  const arrives = arriveBy(p.orderDate, p.handlingDaysMax, p.deliveryDaysMax);
  return compareDates(arrives, addDays(p.occasionDate, -SAFETY_BUFFER_DAYS)) <= 0;
}
