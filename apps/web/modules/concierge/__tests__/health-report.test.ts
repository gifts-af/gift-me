import { describe, expect, it } from "vitest";
import { healthReport, type Problem } from "../health/report";
import { MONDAY, settings, snapshot, TUESDAY, vendors, withToday } from "./health-fixtures";

const kinds = (ps: Problem[]) => ps.map((p) => p.kind);
const run = (snap = snapshot(), v = vendors, s = settings, now = TUESDAY) => healthReport(snap, v, s, now);

describe("healthReport", () => {
  it("AC-1: four problems, each under its kind", () => {
    const r = run(
      snapshot({
        stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }],
        unconfirmed: [{ orderId: "o1", roundId: "r2", userId: "u1" }],
        placingStale: [{ orderId: "o2", roundId: "r3", userId: "u1" }],
        heldZinc: [{ orderId: "o3", roundId: "r4", userId: "u1", holdReason: "retry" }],
      }),
    );
    expect(kinds(r.problems)).toEqual(["stuck_round", "unconfirmed", "placing", "held_zinc"]);
    expect(r.problems[1].ids).toEqual({ orderId: "o1", roundId: "r2", userId: "u1" });
  });

  it("AC-2: nothing actionable on a Tuesday gives no problems and isWeekly false", () => {
    const r = run(snapshot({ weekly: { ...snapshot().weekly, waitingAddress: 1, waitingFunds: 1 } }));
    expect(r.problems).toEqual([]);
    expect(r.isWeekly).toBe(false);
  });

  it("AC-3: the same on a Monday is weekly with counts 1 address, 1 funds", () => {
    const r = run(snapshot({ weekly: { ...snapshot().weekly, waitingAddress: 1, waitingFunds: 1 } }), vendors, settings, MONDAY);
    expect(r.problems).toEqual([]);
    expect(r.isWeekly).toBe(true);
    expect(r.weekly).toMatchObject({ waitingAddress: 1, waitingFunds: 1 });
  });

  it("AC-4: a deadline_close round is listed", () => {
    const r = run(snapshot({ deadlineClose: [{ roundId: "r1", userId: "u1", reason: "address", shipByDeadline: "2026-12-01" }] }));
    expect(r.problems).toEqual([
      { kind: "deadline_close", ids: { roundId: "r1", userId: "u1" }, detail: { reason: "address", shipByDeadline: "2026-12-01" } },
    ]);
  });

  it("AC-5: no row for today leads with tick_missed and the last ok finish", () => {
    const base = snapshot();
    const r = run({ ...base, tick: { ...base.tick, today: null } });
    expect(r.problems[0]).toEqual({ kind: "tick_missed", detail: { lastOkFinishedAt: "2026-11-23T10:05:00Z" } });
  });

  it("AC-5: a row that started and never finished is tick_missed, and the round and order problems are still listed", () => {
    const r = run({
      ...withToday({ finishedAt: null, result: null }),
      unconfirmed: [{ orderId: "o1", roundId: "r2", userId: "u1" }],
      stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }],
    });
    expect(kinds(r.problems)).toEqual(["tick_missed", "stuck_round", "unconfirmed"]);
  });

  it("today's row finished ok gives no tick_missed", () => {
    expect(kinds(run().problems)).not.toContain("tick_missed");
  });

  it("with no ok finish on record, tick_missed has no lastOkFinishedAt", () => {
    const base = snapshot();
    const r = run({ ...base, tick: { lastOkFinishedAt: null, today: null } });
    expect(r.problems[0]).toEqual({ kind: "tick_missed", detail: {} });
  });

  it("AC-6: result failed, or fanout_failed 1, gives tick_failed with the counts", () => {
    const failed = run(withToday({ result: "failed", roundsFailed: 2, fanoutFailed: 0 }));
    expect(failed.problems).toEqual([{ kind: "tick_failed", detail: { roundsFailed: 2, fanoutFailed: 0 } }]);
    const fanout = run(withToday({ fanoutFailed: 1 }));
    expect(fanout.problems).toEqual([{ kind: "tick_failed", detail: { roundsFailed: 0, fanoutFailed: 1 } }]);
  });

  it("rounds_failed 2 alone gives no tick_failed and shows in weekly", () => {
    const snap = { ...withToday({ roundsFailed: 2 }), weekly: { ...snapshot().weekly, roundsFailed: 2 } };
    const r = run(snap);
    expect(r.problems).toEqual([]);
    expect(r.weekly?.roundsFailed).toBe(2);
  });

  it("AC-7: on a Monday, rounds_failed 2 is in weekly and no_credit_runs 1 leads with no_credit", () => {
    const snap = { ...snapshot({ noCreditRuns: 1 }), weekly: { ...snapshot().weekly, roundsFailed: 2 } };
    const r = run(snap, vendors, settings, MONDAY);
    expect(r.problems[0].kind).toBe("no_credit");
    expect(r.weekly?.roundsFailed).toBe(2);
    expect(r.isWeekly).toBe(true);
  });

  it("AC-8: a null snapshot gives only db_down", () => {
    const r = healthReport(null, vendors, settings, TUESDAY);
    expect(r.problems).toEqual([{ kind: "db_down" }]);
    expect(r.weekly).toBeNull();
  });

  it("AC-9: idea engine on and AI not configured gives ideas_not_configured", () => {
    const r = run(snapshot(), { ...vendors, aiConfigured: false }, { ...settings, ideaEngineEnabled: true });
    expect(kinds(r.problems)).toEqual(["ideas_not_configured"]);
  });

  it("idea engine on and Zinc not configured does too", () => {
    const r = run(snapshot(), { ...vendors, zincConfigured: false }, { ...settings, ideaEngineEnabled: true });
    expect(kinds(r.problems)).toEqual(["ideas_not_configured"]);
  });

  it("capture extraction on and AI not configured does too, but Zinc missing alone doesn't", () => {
    const s = { ...settings, captureExtractionEnabled: true };
    expect(kinds(run(snapshot(), { ...vendors, aiConfigured: false }, s).problems)).toEqual(["ideas_not_configured"]);
    expect(kinds(run(snapshot(), { ...vendors, zincConfigured: false }, s).problems)).toEqual([]);
  });

  it("AC-11: no_credit_runs 1, or a 0 balance, leads with no_credit (after tick_missed when both)", () => {
    expect(kinds(run(snapshot({ noCreditRuns: 1 })).problems)).toEqual(["no_credit"]);
    expect(kinds(run(snapshot(), { ...vendors, aiCreditCents: 0 }).problems)).toEqual(["no_credit"]);
    const base = snapshot({ noCreditRuns: 1 });
    const r = run({ ...base, tick: { ...base.tick, today: null } }, { ...vendors, aiCreditCents: 0 });
    expect(kinds(r.problems)).toEqual(["tick_missed", "no_credit"]);
  });

  it("AC-11: while no_credit, ideas_waiting rounds are listed under it; without it they aren't", () => {
    const waiting = [{ roundId: "r9", userId: "u1", shipByDeadline: "2026-12-01" }];
    const on = run(snapshot({ noCreditRuns: 1, ideasWaiting: waiting }));
    expect(on.problems[0].waiting).toEqual(waiting);
    const off = run(snapshot({ ideasWaiting: waiting }));
    expect(off.problems).toEqual([]);
  });

  it("AC-12: 499 cents is credit_low, 500 isn't", () => {
    expect(kinds(run(snapshot(), { ...vendors, aiCreditCents: 499 }).problems)).toEqual(["credit_low"]);
    expect(kinds(run(snapshot(), { ...vendors, aiCreditCents: 500 }).problems)).toEqual([]);
  });

  it("the Zinc app balance below 500 is zinc_low", () => {
    const r = run(snapshot(), { ...vendors, zincAppBalanceCents: 120 });
    expect(r.problems).toEqual([{ kind: "zinc_low", detail: { balanceCents: 120, lowCents: 500 } }]);
  });

  it("a failed vendor call (null) adds no problem", () => {
    const r = run(snapshot(), { ...vendors, aiCreditCents: null, zincAppBalanceCents: null });
    expect(r.problems).toEqual([]);
  });

  it("orders the kinds db_down first, then tick, credit, failures, then the table's order", () => {
    const base = snapshot({
      noCreditRuns: 1,
      stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }],
      deadlineClose: [{ roundId: "r5", userId: "u1", reason: "funds", shipByDeadline: "2026-12-01" }],
    });
    const snap = { ...base, tick: { ...base.tick, today: { ...base.tick.today!, result: "failed" as const } } };
    expect(kinds(run(snap, { ...vendors, zincAppBalanceCents: 1 }).problems)).toEqual([
      "no_credit",
      "tick_failed",
      "stuck_round",
      "zinc_low",
      "deadline_close",
    ]);
  });
});
