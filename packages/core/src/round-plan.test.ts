import { describe, expect, it } from "vitest";
import { addDays, compareDates, type CalendarDate } from "./dates";
import { nextAction, PLACEABLE_HOLDS, roundToCreate, type RoundView, type StepKey } from "./round-plan";
import type { ScheduleSettings } from "./schedule";

const s: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
  holdReminderDays: 7,
  holdFinalDays: 2,
};

const NO_HOLD = {
  attentionReason: null,
  holdCount: 0,
  seenBalanceCents: null,
  emailedBalanceCents: null,
  placeTried: false,
} as const;

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
  ...NO_HOLD,
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

  it("never sends an earlier reminder after a later one went out", () => {
    const a = (sent: StepKey[]) => nextAction({ ...approval("2027-02-22"), sent: new Set(sent) }, "2027-03-21", s);
    expect(a(["final_notice"])).toEqual({ do: "wait", until: "2027-03-22" });
    expect(a(["reminder_2"])).toEqual({ do: "send", send: "final_notice" });
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
    ...NO_HOLD,
    ...over,
  });

  // ALL-63: a shared address can arrive on any day, and the deadline skip comes first, so the
  // round looks every day. No email goes unless a reminder is due.
  it("is looked at again tomorrow, never later, while it waits (ALL-63 AC-19)", () => {
    const sent = new Set<StepKey>(["address_request"]);
    expect(nextAction(needs({ sent }), "2027-02-23", s)).toEqual({ do: "wait", until: "2027-02-24" });
    // A reminder still goes on its own day, and the next day's look is the deadline.
    expect(nextAction(needs({ sent }), "2027-03-20", s)).toEqual({ do: "send", send: "address_final_notice" });
    sent.add("address_final_notice");
    expect(nextAction(needs({ sent }), "2027-03-21", s)).toEqual({ do: "wait", until: "2027-03-22" });
  });

  it("an address that arrives on the deadline day still skips: the deadline comes first (ALL-63 AC-21)", () => {
    expect(nextAction(needs({ hasAddress: true }), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
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
    ...NO_HOLD,
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

  it("skips at the deadline from every actionable status, before any other work", () => {
    expect(nextAction(view("generating"), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
    expect(nextAction(view("scheduled"), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
    expect(nextAction(view("awaiting_approval"), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
    expect(nextAction(view("needs_address"), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
  });

  describe("a gift held for an address, when a shared address arrives (ALL-63)", () => {
    const held = (over: Partial<RoundView> = {}) =>
      ({ ...view("needs_attention"), attentionReason: "address", holdCount: 1, ...over }) as RoundView;

    it("places it, ahead of asking the buyer to fix an address they can't edit", () => {
      expect(nextAction(held({ hasSharedAddress: true }), "2027-03-01", s)).toEqual({ do: "place" });
    });

    it("tries once a run, then carries on as any address hold does", () => {
      expect(nextAction(held({ hasSharedAddress: true, placeTried: true }), "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:1:notice" });
    });

    it("with nothing usable shared, it still asks the buyer", () => {
      expect(nextAction(held(), "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:1:notice" });
    });

    it("the deadline still comes first", () => {
      expect(nextAction(held({ hasSharedAddress: true }), "2027-03-22", s).do).toBe("skip");
    });
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

describe("nextAction: money holds (AC-20, AC-22, AC-23)", () => {
  // Deadline 2027-03-22: reminder at -7 is 03-15, final at -2 is 03-20.
  const hold = (over: Partial<RoundView> = {}): RoundView => ({
    status: "needs_attention",
    shipByDeadline: "2027-03-22",
    headsUpOn: "2027-02-22",
    hasAddress: true,
    sent: new Set(),
    attentionReason: "funds",
    holdCount: 1,
    seenBalanceCents: 1000,
    emailedBalanceCents: 1000,
    placeTried: false,
    ...over,
  });
  // The rest of a run, once it has tried placing today: the reminders come after the try,
  // so a gift that just got bought never gets a "top up" email.
  const tried = (over: Partial<RoundView> = {}) => hold({ placeTried: true, ...over });
  const sent = (...keys: StepKey[]) => new Set<StepKey>(keys);
  const wait = { do: "wait", until: "2027-03-22" };

  it("sends the notice first for a funds hold, even before placing", () => {
    expect(nextAction(hold(), "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:1:notice" });
  });

  it("sends the notice for setup, address and unconfirmed holds too", () => {
    for (const attentionReason of ["setup", "address", "unconfirmed"] as const) {
      expect(nextAction(hold({ attentionReason }), "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:1:notice" });
    }
  });

  it("tries to place after the notice, before any reminder", () => {
    expect(nextAction(hold({ sent: sent("hold:1:notice") }), "2027-03-01", s)).toEqual({ do: "place" });
    expect(nextAction(hold({ sent: sent("hold:1:notice") }), "2027-03-20", s)).toEqual({ do: "place" });
  });

  // S4: Zinc already rejected the address, or there is none; only saving the person's
  // address places it again, never the tick.
  it("never places an address hold: its notice, then the reminders on schedule", () => {
    const addr = (over: Partial<RoundView> = {}) => hold({ attentionReason: "address", ...over });
    expect(nextAction(addr({ sent: sent("hold:1:notice") }), "2027-03-01", s)).toEqual(wait);
    expect(nextAction(addr({ sent: sent("hold:1:notice") }), "2027-03-15", s)).toEqual({ do: "send_hold", send: "hold:1:reminder" });
    expect(nextAction(addr({ sent: sent("hold:1:notice", "hold:1:reminder") }), "2027-03-20", s)).toEqual({
      do: "send_hold",
      send: "hold:1:final",
    });
    expect(PLACEABLE_HOLDS).not.toContain("address");
  });

  // S8: with ordering switched off, topping up wouldn't buy anything, so a funds hold gets no
  // more emails (the deadline sends missed_on_us instead, in the engine).
  it("sends no funds emails while ordering is switched off", () => {
    const paused = { orderingPaused: true };
    expect(nextAction(tried({ ...paused }), "2027-03-01", s)).toEqual(wait);
    expect(nextAction(tried({ ...paused, sent: sent("hold:1:notice") }), "2027-03-15", s)).toEqual(wait);
    expect(nextAction(tried({ ...paused, sent: sent("hold:1:notice") }), "2027-03-20", s)).toEqual(wait);
    expect(nextAction(tried({ ...paused, sent: sent("hold:1:notice"), seenBalanceCents: 2000 }), "2027-03-01", s)).toEqual(wait);
    // It still tries placing (the gate holds it as paused), and other holds still tell the buyer.
    expect(nextAction(hold({ ...paused, sent: sent("hold:1:notice") }), "2027-03-01", s)).toEqual({ do: "place" });
    expect(nextAction(tried({ ...paused, attentionReason: "setup", sent: sent("hold:1:notice") }), "2027-03-15", s)).toEqual({
      do: "send_hold",
      send: "hold:1:reminder",
    });
  });

  it("waits once it has tried placing and nothing is due", () => {
    expect(nextAction(tried({ sent: sent("hold:1:notice") }), "2027-03-01", s)).toEqual(wait);
  });

  it("sends a short notice with today's key when the balance rose but is still short", () => {
    const r = tried({ sent: sent("hold:1:notice"), seenBalanceCents: 2000 });
    expect(nextAction(r, "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:1:short:2027-03-01", shortfall: true });
  });

  it("does not send the short notice twice the same day, but can on another", () => {
    const r = tried({ sent: sent("hold:1:notice", "hold:1:short:2027-03-01"), seenBalanceCents: 2000 });
    expect(nextAction(r, "2027-03-01", s)).toEqual(wait);
    expect(nextAction(r, "2027-03-02", s)).toEqual({ do: "send_hold", send: "hold:1:short:2027-03-02", shortfall: true });
  });

  it("sends no short notice when a balance is unknown or not higher", () => {
    const base = { sent: sent("hold:1:notice") };
    expect(nextAction(tried({ ...base, seenBalanceCents: null }), "2027-03-01", s)).toEqual(wait);
    expect(nextAction(tried({ ...base, emailedBalanceCents: null }), "2027-03-01", s)).toEqual(wait);
    expect(nextAction(tried({ ...base, seenBalanceCents: 500 }), "2027-03-01", s)).toEqual(wait);
  });

  it("sends no short notice for other reasons", () => {
    const r = tried({ attentionReason: "setup", sent: sent("hold:1:notice"), seenBalanceCents: 2000 });
    expect(nextAction(r, "2027-03-01", s)).toEqual(wait);
  });

  it("sends the reminder 7 days before the deadline and the final notice 2 days before", () => {
    const base = { sent: sent("hold:1:notice") };
    expect(nextAction(tried(base), "2027-03-14", s)).toEqual(wait);
    expect(nextAction(tried(base), "2027-03-15", s)).toEqual({ do: "send_hold", send: "hold:1:reminder" });
    expect(nextAction(tried({ sent: sent("hold:1:notice", "hold:1:reminder") }), "2027-03-16", s)).toEqual(wait);
    expect(nextAction(tried({ sent: sent("hold:1:notice", "hold:1:reminder") }), "2027-03-20", s)).toEqual({
      do: "send_hold",
      send: "hold:1:final",
    });
    expect(nextAction(tried({ sent: sent("hold:1:notice", "hold:1:final") }), "2027-03-21", s)).toEqual(wait);
  });

  it("sends only the final notice, not a missed reminder, when both are overdue", () => {
    expect(nextAction(tried({ sent: sent("hold:1:notice") }), "2027-03-21", s)).toEqual({ do: "send_hold", send: "hold:1:final" });
  });

  it("uses the round's hold count in every key", () => {
    expect(nextAction(hold({ holdCount: 2 }), "2027-03-01", s)).toEqual({ do: "send_hold", send: "hold:2:notice" });
    expect(nextAction(hold({ holdCount: 2, sent: sent("hold:1:notice") }), "2027-03-01", s)).toEqual({
      do: "send_hold",
      send: "hold:2:notice",
    });
  });

  it("places for paused, not_allowed and retry without emailing them", () => {
    for (const attentionReason of ["paused", "not_allowed", "retry"] as const) {
      for (const day of ["2027-03-01", "2027-03-15", "2027-03-20"] as const) {
        expect(nextAction(hold({ attentionReason }), day, s)).toEqual({ do: "place" });
      }
      expect(nextAction(tried({ attentionReason }), "2027-03-15", s)).toEqual(wait);
    }
  });

  it("tells the buyer once when the store is still unreachable on the final day (retry only)", () => {
    expect(nextAction(tried({ attentionReason: "retry" }), "2027-03-19", s)).toEqual(wait);
    expect(nextAction(tried({ attentionReason: "retry" }), "2027-03-20", s)).toEqual({ do: "send_hold", send: "hold_trouble" });
    expect(nextAction(tried({ attentionReason: "retry", sent: sent("hold_trouble") }), "2027-03-21", s)).toEqual(wait);
    for (const attentionReason of ["paused", "not_allowed"] as const) {
      expect(nextAction(tried({ attentionReason }), "2027-03-20", s)).toEqual(wait);
    }
  });

  it("sends an unconfirmed round only its notice, never the reminders", () => {
    for (const day of ["2027-03-01", "2027-03-15", "2027-03-21"] as const) {
      expect(nextAction(hold({ attentionReason: "unconfirmed", sent: sent("hold:1:notice") }), day, s)).toEqual(wait);
    }
  });

  it("leaves failures to the engine, which tells each one by its own key (ALL-116), and waits", () => {
    for (const attentionReason of ["price_up", "out_of_stock", "too_late", "failed"] as const) {
      expect(nextAction(hold({ attentionReason }), "2027-03-01", s)).toEqual(wait);
    }
  });

  it("waits with no reason", () => {
    expect(nextAction(hold({ attentionReason: null }), "2027-03-01", s)).toEqual(wait);
  });

  it("refuses a final hold email that isn't before the reminder", () => {
    expect(() => nextAction(tried({ sent: sent("hold:1:notice") }), "2027-03-01", { ...s, holdFinalDays: 7 })).toThrow(
      RangeError,
    );
  });

  it("skips on the deadline day whatever the hold", () => {
    expect(nextAction(hold(), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
    expect(nextAction(hold({ attentionReason: "paused" }), "2027-03-22", s)).toEqual({ do: "skip", send: "skipped" });
  });
});
