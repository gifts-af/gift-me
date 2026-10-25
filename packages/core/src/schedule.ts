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

/** The last day an order can be placed and still arrive, with the buffer. */
export function shipByDeadline(
  occasionDate: CalendarDate,
  worstCaseDeliveryDays: number = PLANNING_DELIVERY_DAYS,
): CalendarDate {
  checkDays(worstCaseDeliveryDays, "Delivery days");
  return addDays(occasionDate, -(worstCaseDeliveryDays + SAFETY_BUFFER_DAYS));
}

/** When a round normally starts: 28 days before the planning deadline. */
export function roundStartDate(occasionDate: CalendarDate): CalendarDate {
  return addDays(shipByDeadline(occasionDate), -ROUND_LEAD_DAYS);
}

/**
 * A round never starts in the past. If today is already after the normal
 * start (a person added close to their birthday), it starts today and is
 * marked late so the heads-up can say so.
 */
export function planRoundStart(
  occasionDate: CalendarDate,
  today: CalendarDate,
): { startDate: CalendarDate; deadline: CalendarDate; late: boolean } {
  const normalStart = roundStartDate(occasionDate);
  return {
    startDate: maxDate(today, normalStart),
    deadline: shipByDeadline(occasionDate),
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

/** An idea is still worth offering if its slowest case arrives by the occasion. */
export function canArriveInTime(arriveByDate: CalendarDate, occasionDate: CalendarDate): boolean {
  return compareDates(arriveByDate, occasionDate) <= 0;
}
