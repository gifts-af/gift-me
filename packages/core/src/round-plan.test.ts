import { describe, expect, it } from "vitest";
import { addDays, compareDates, type CalendarDate } from "./dates";
import { nextAction, roundToCreate, type RoundView, type StepKey } from "./round-plan";
import type { ScheduleSettings } from "./schedule";

const s: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
};

const rule = { kind: "birthday", month: 3, day: 31 } as const;

describe("roundToCreate", () => {
  it("is null before the round's start day", () => {
    expect(roundToCreate(rule, "2027-02-21", s)).toBeNull();
  });

  it("creates a normal round on the start day", () => {
    expect(roundToCreate(rule, "2027-02-22", s)).toEqual({
      occasionDate: "2027-03-31",
      occasionYear: 2027,
      shipByDeadline: "2027-03-22",
      late: false,
    });
  });

  it("creates a late round after the normal start", () => {
    expect(roundToCreate(rule, "2027-03-20", s)).toMatchObject({ late: true, shipByDeadline: "2027-03-22" });
  });

  it("is null once even the fastest deadline has passed (AC-7)", () => {
    expect(roundToCreate(rule, "2027-03-29", s)).toBeNull();
  });
});

/** Walks day by day, recording each step as sent when it fires; stops after the first skip. */
function walk(base: RoundView, from: CalendarDate, to: CalendarDate): [CalendarDate, string][] {
  const sent = new Set<StepKey>();
  const fired: [CalendarDate, string][] = [];
  for (let day = from; compareDates(day, to) <= 0; day = addDays(day, 1)) {
    const action = nextAction({ ...base, sent }, day, s);
    if (action.do === "send" || action.do === "skip") {
      fired.push([day, action.send]);
      sent.add(action.send);
      if (action.do === "skip") break;
    }
  }
  return fired;
}

const approval = (headsUpOn: CalendarDate): RoundView => ({
  status: "awaiting_approval",
  shipByDeadline: "2027-03-22",
  headsUpOn,
  hasAddress: true,
  sent: new Set(),
});

describe("nextAction: awaiting approval", () => {
  it("fires the full schedule on its days (AC-5)", () => {
    expect(walk(approval("2027-02-22"), "2027-02-22", "2027-03-25")).toEqual([
      ["2027-02-27", "reminder_1"],
      ["2027-03-15", "reminder_2"],
      ["2027-03-20", "final_notice"],
      ["2027-03-22", "skipped"],
    ]);
  });

  it("waits until the next due day in between", () => {
    expect(nextAction(approval("2027-02-22"), "2027-02-23", s)).toEqual({ do: "wait", until: "2027-02-27" });
    expect(nextAction({ ...approval("2027-02-22"), sent: new Set<StepKey>(["reminder_1"]) }, "2027-02-28", s)).toEqual({
      do: "wait",
      until: "2027-03-15",
    });
  });

  it("gives only the final notice and skip after a late heads-up (AC-6)", () => {
    expect(walk(approval("2027-03-17"), "2027-03-17", "2027-03-25")).toEqual([
      ["2027-03-20", "final_notice"],
      ["2027-03-22", "skipped"],
    ]);
  });

  it("sends only the latest overdue reminder after a missed tick", () => {
    expect(nextAction(approval("2027-02-22"), "2027-03-21", s)).toEqual({ do: "send", send: "final_notice" });
  });

  it("lets an overdue skip win over reminders", () => {
    expect(nextAction(approval("2027-02-22"), "2027-03-23", s)).toEqual({ do: "skip", send: "skipped" });
  });

  it("throws without a heads-up day", () => {
    expect(() => nextAction({ ...approval("2027-02-22"), headsUpOn: null }, "2027-03-01", s)).toThrow(RangeError);
  });
});

describe("nextAction: address path", () => {
  const needs = (over: Partial<RoundView> = {}): RoundView => ({
    status: "needs_address",
    shipByDeadline: "2027-03-22",
    headsUpOn: "2027-02-22",
    hasAddress: false,
    sent: new Set(),
    ...over,
  });

  it("fires the address_* steps on the same days (AC-8)", () => {
    expect(walk(needs(), "2027-02-22", "2027-03-25")).toEqual([
      ["2027-02-27", "address_reminder_1"],
      ["2027-03-15", "address_reminder_2"],
      ["2027-03-20", "address_final_notice"],
      ["2027-03-22", "skipped"],
    ]);
  });

  it("generates as soon as an address arrives", () => {
    expect(nextAction(needs({ hasAddress: true }), "2027-03-01", s)).toEqual({ do: "generate" });
  });

  it("throws without a request day", () => {
    expect(() => nextAction(needs({ headsUpOn: null }), "2027-03-01", s)).toThrow(RangeError);
  });
});

describe("nextAction: other statuses", () => {
  const view = (status: RoundView["status"], over: Partial<RoundView> = {}): RoundView => ({
    status,
    shipByDeadline: "2027-03-22",
    headsUpOn: null,
    hasAddress: false,
    sent: new Set(),
    ...over,
  });

  it("asks for an address when scheduled without one", () => {
    expect(nextAction(view("scheduled"), "2027-02-22", s)).toEqual({ do: "request_address", send: "address_request" });
  });

  it("generates when scheduled with an address", () => {
    expect(nextAction(view("scheduled", { hasAddress: true }), "2027-02-22", s)).toEqual({ do: "generate" });
  });

  it("generates for a round stuck in generating", () => {
    expect(nextAction(view("generating"), "2027-02-22", s)).toEqual({ do: "generate" });
  });

  it("skips a needs_attention round only at the deadline", () => {
    expect(nextAction(view("needs_attention"), "2027-03-21", s)).toEqual({ do: "wait", until: "2027-03-22" });
    expect(nextAction(view("needs_attention"), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
  });

  it("waits (never acts) for ordered, delivered, complete and skipped rounds", () => {
    for (const status of ["ordered", "delivered", "complete", "skipped"] as const) {
      expect(nextAction(view(status), "2027-03-25", s)).toEqual({ do: "wait", until: "2027-03-22" });
    }
  });
});
