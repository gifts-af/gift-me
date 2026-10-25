import { describe, expect, it } from "vitest";
import {
  arriveBy,
  canArriveInTime,
  planRoundStart,
  reminderSchedule,
  roundStartDate,
  shipByDeadline,
  type ScheduleSettings,
} from "./schedule";

// Today's values (design §4.1). In the app they come from `app_settings`.
const s: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
};

describe("ship-by deadline", () => {
  it("leaves the planning default plus the buffer", () => {
    expect(shipByDeadline("2026-12-25", s)).toBe("2026-12-16");
  });

  it("uses the chosen idea's worst-case days to arrive", () => {
    expect(shipByDeadline("2026-12-25", s, 3)).toBe("2026-12-20");
  });

  it("follows the settings, not built-in numbers", () => {
    expect(shipByDeadline("2026-12-25", { ...s, planningDeliveryDays: 10, safetyBufferDays: 3 })).toBe("2026-12-12");
  });

  it("rejects negative delivery days", () => {
    expect(() => shipByDeadline("2026-12-25", s, -1)).toThrow(RangeError);
  });

  it("rejects settings that aren't whole days", () => {
    expect(() => shipByDeadline("2026-12-25", { ...s, safetyBufferDays: -1 })).toThrow(RangeError);
    expect(() => shipByDeadline("2026-12-25", { ...s, safetyBufferDays: 1.5 })).toThrow(RangeError);
  });
});

describe("round start", () => {
  it("starts the lead time before the planning deadline", () => {
    expect(roundStartDate("2026-12-25", s)).toBe("2026-11-18");
    expect(roundStartDate("2026-12-25", { ...s, roundLeadDays: 14 })).toBe("2026-12-02");
  });

  it("is on time when today is before the normal start", () => {
    expect(planRoundStart("2026-12-25", "2026-11-01", s)).toEqual({
      startDate: "2026-11-18",
      deadline: "2026-12-16",
      late: false,
    });
  });

  it("is on time on the normal start day itself", () => {
    expect(planRoundStart("2026-12-25", "2026-11-18", s)?.late).toBe(false);
  });

  it("starts today and is marked late after the normal start", () => {
    expect(planRoundStart("2026-12-25", "2026-12-01", s)).toEqual({
      startDate: "2026-12-01",
      deadline: "2026-12-16",
      late: true,
    });
  });

  it("moves the deadline to the fastest shipping once the planning deadline has passed", () => {
    // Added 5 days before a birthday: next-day delivery plus the buffer still makes it.
    expect(planRoundStart("2026-10-30", "2026-10-25", s)).toEqual({
      startDate: "2026-10-25",
      deadline: "2026-10-27",
      late: true,
    });
  });

  it("moves the deadline when the planning deadline is today", () => {
    expect(planRoundStart("2026-12-25", "2026-12-16", s)).toEqual({
      startDate: "2026-12-16",
      deadline: "2026-12-22",
      late: true,
    });
  });

  it("gives no round when even the fastest shipping can't make it", () => {
    // 3 days out: the next-day deadline would be today, leaving no day to answer.
    expect(planRoundStart("2026-10-28", "2026-10-25", s)).toBeNull();
    expect(planRoundStart("2026-10-28", "2026-10-28", s)).toBeNull();
  });
});

describe("reminder schedule", () => {
  const deadline = "2026-12-16";

  it("follows the normal schedule when the heads-up goes out on time", () => {
    expect(reminderSchedule(deadline, "2026-11-21", s)).toEqual([
      { kind: "reminder_1", date: "2026-11-26" },
      { kind: "reminder_2", date: "2026-12-09" },
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("uses the reminder timings from the settings", () => {
    const quick = { ...s, reminder1AfterHeadsUpDays: 3, reminder2BeforeDeadlineDays: 4, finalNoticeBeforeDeadlineDays: 1 };
    expect(reminderSchedule(deadline, "2026-11-21", quick)).toEqual([
      { kind: "reminder_1", date: "2026-11-24" },
      { kind: "reminder_2", date: "2026-12-12" },
      { kind: "final_notice", date: "2026-12-15" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("drops reminders that would land on or before a late heads-up", () => {
    expect(reminderSchedule(deadline, "2026-12-10", s)).toEqual([
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("drops reminder 1 when it would land on or after reminder 2", () => {
    expect(reminderSchedule(deadline, "2026-12-04", s)).toEqual([
      { kind: "reminder_2", date: "2026-12-09" },
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("only skips when the heads-up goes out the day before the deadline", () => {
    expect(reminderSchedule(deadline, "2026-12-15", s)).toEqual([{ kind: "skip", date: "2026-12-16" }]);
  });

  it("refuses a heads-up on or after the deadline instead of scheduling a skip in the past", () => {
    expect(() => reminderSchedule(deadline, "2026-12-16", s)).toThrow(RangeError);
    expect(() => reminderSchedule(deadline, "2026-12-20", s)).toThrow(RangeError);
  });
});

describe("arrival", () => {
  it("adds the slowest handling and delivery days to the order date", () => {
    expect(arriveBy("2026-12-01", 1, 5)).toBe("2026-12-07");
  });

  it("rejects negative handling or delivery days", () => {
    expect(() => arriveBy("2026-12-01", -1, 5)).toThrow(RangeError);
    expect(() => arriveBy("2026-12-01", 1, -5)).toThrow(RangeError);
  });

  it("keeps the buffer when filtering ideas", () => {
    const idea = { occasionDate: "2026-12-25", orderDate: "2026-12-16", handlingDaysMax: 2 };
    // Arrives 12-23, two days early: in time.
    expect(canArriveInTime({ ...idea, deliveryDaysMax: 5 }, s)).toBe(true);
    // Arrives 12-24, only one day early: too close.
    expect(canArriveInTime({ ...idea, deliveryDaysMax: 6 }, s)).toBe(false);
    // With a 1-day buffer, the same idea is in time.
    expect(canArriveInTime({ ...idea, deliveryDaysMax: 6 }, { ...s, safetyBufferDays: 1 })).toBe(true);
  });
});
