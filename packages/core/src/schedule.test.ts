import { describe, expect, it } from "vitest";
import {
  arriveBy,
  canArriveInTime,
  planRoundStart,
  reminderSchedule,
  roundStartDate,
  shipByDeadline,
} from "./schedule";

describe("ship-by deadline", () => {
  it("leaves the planning default plus a 2-day buffer", () => {
    expect(shipByDeadline("2026-12-25")).toBe("2026-12-16");
  });

  it("uses the chosen idea's worst-case delivery days", () => {
    expect(shipByDeadline("2026-12-25", 3)).toBe("2026-12-20");
  });

  it("rejects negative delivery days", () => {
    expect(() => shipByDeadline("2026-12-25", -1)).toThrow(RangeError);
  });
});

describe("round start", () => {
  it("starts 28 days before the planning deadline", () => {
    expect(roundStartDate("2026-12-25")).toBe("2026-11-18");
  });

  it("is on time when today is before the normal start", () => {
    expect(planRoundStart("2026-12-25", "2026-11-01")).toEqual({
      startDate: "2026-11-18",
      deadline: "2026-12-16",
      late: false,
    });
  });

  it("is on time on the normal start day itself", () => {
    expect(planRoundStart("2026-12-25", "2026-11-18").late).toBe(false);
  });

  it("starts today and is marked late after the normal start", () => {
    expect(planRoundStart("2026-12-25", "2026-12-01")).toEqual({
      startDate: "2026-12-01",
      deadline: "2026-12-16",
      late: true,
    });
  });
});

describe("reminder schedule", () => {
  const deadline = "2026-12-16";

  it("follows the normal schedule when the heads-up goes out on time", () => {
    expect(reminderSchedule(deadline, "2026-11-21")).toEqual([
      { kind: "reminder_1", date: "2026-11-26" },
      { kind: "reminder_2", date: "2026-12-09" },
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("drops reminders that would land on or before a late heads-up", () => {
    expect(reminderSchedule(deadline, "2026-12-10")).toEqual([
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("drops reminder 1 when it would land on or after reminder 2", () => {
    expect(reminderSchedule(deadline, "2026-12-04")).toEqual([
      { kind: "reminder_2", date: "2026-12-09" },
      { kind: "final_notice", date: "2026-12-14" },
      { kind: "skip", date: "2026-12-16" },
    ]);
  });

  it("only skips when the heads-up goes out the day before the deadline", () => {
    expect(reminderSchedule(deadline, "2026-12-15")).toEqual([{ kind: "skip", date: "2026-12-16" }]);
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

  it("is in time on the occasion day and late the day after", () => {
    expect(canArriveInTime("2026-12-25", "2026-12-25")).toBe(true);
    expect(canArriveInTime("2026-12-26", "2026-12-25")).toBe(false);
  });
});
