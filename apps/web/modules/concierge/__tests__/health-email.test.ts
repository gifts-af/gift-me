import { describe, expect, it } from "vitest";
import { inboxFor } from "@/lib/brand";
import { buildHealthEmail, RUNBOOK_ANCHORS } from "../health/email";
import { healthReport, type ProblemKind } from "../health/report";
import { MONDAY, settings, snapshot, TUESDAY, vendors } from "./health-fixtures";

const BASE = "https://example.test/operations.md";
const build = (snap: ReturnType<typeof snapshot> | null, now = TUESDAY, v = vendors) =>
  buildHealthEmail(healthReport(snap, v, settings, now), BASE);

describe("buildHealthEmail", () => {
  it("AC-5 and AC-11 lead lines are the first row", () => {
    const base = snapshot();
    const missed = build({ ...base, tick: { lastOkFinishedAt: "2026-11-23T10:05:00Z", today: null } });
    expect(missed.html).toContain("Today&#39;s round engine run didn&#39;t finish");
    expect(missed.text).toContain("- Today's round engine run didn't finish (Last successful finish: 2026-11-23 10:05 UTC)");
    const never = build({ ...base, tick: { lastOkFinishedAt: null, today: null } });
    expect(never.text).toContain("none on record");

    const credit = build(snapshot({ noCreditRuns: 1, ideasWaiting: [{ roundId: "r9", userId: "u1", shipByDeadline: "2026-12-01" }] }));
    const firstRow = credit.text.split("\n").find((l) => l.startsWith("- "));
    expect(firstRow).toContain("Out of AI credit: ideas are paused");
    expect(firstRow).toContain("r9");
  });

  it("every row's link is runbookBase#RUNBOOK_ANCHORS[kind]", () => {
    const every = healthReport(
      snapshot({
        noCreditRuns: 1,
        stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }],
        unconfirmed: [{ orderId: "o1", roundId: "r2", userId: "u1" }],
        placingStale: [{ orderId: "o2", roundId: "r3", userId: "u1" }],
        heldZinc: [{ orderId: "o3", roundId: "r4", userId: "u1", holdReason: "retry" }],
        deadlineClose: [{ roundId: "r5", userId: "u1", reason: "funds", shipByDeadline: "2026-12-01" }],
      }),
      { ...vendors, aiCreditCents: 0, zincAppBalanceCents: 1, aiConfigured: false },
      { ...settings, ideaEngineEnabled: true },
      TUESDAY,
    );
    const kinds = every.problems.map((p) => p.kind);
    const email = buildHealthEmail(every, BASE);
    const hrefs = [...email.html!.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(kinds.map((k: ProblemKind) => `${BASE}#${RUNBOOK_ANCHORS[k]}`));
  });

  it("AC-3: the weekly email says All clear and lists the counts", () => {
    const e = build(snapshot({ weekly: { ...snapshot().weekly, waitingAddress: 1, waitingFunds: 1, failedCaptures: 2 } }), MONDAY);
    expect(e.subject).toContain("All clear");
    expect(e.text).toContain("All clear");
    expect(e.text).toContain("1 waiting on an address");
    expect(e.text).toContain("1 waiting on funds");
    expect(e.text).toContain("2 failed captures");
  });

  it("the tick-failed email carries the counts", () => {
    const base = snapshot();
    const e = build({ ...base, tick: { ...base.tick, today: { ...base.tick.today!, fanoutFailed: 3, roundsFailed: 1 } } });
    expect(e.text).toContain("The tick reported failures");
    expect(e.text).toContain("3 fan-out sends failed");
  });

  it("the db_down email says so and nothing else", () => {
    const e = build(null);
    expect(e.text).toContain("The database can't be reached");
    expect(e.text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });

  it("the deadline_close row uses the fixed copy", () => {
    const e = build(snapshot({ deadlineClose: [{ roundId: "r5", userId: "u1", reason: "funds", shipByDeadline: "2026-12-01" }] }));
    expect(e.text).toContain("Waiting on the buyer, deadline close");
  });

  it("it goes only to inboxFor(\"health\")", () => {
    expect(build(snapshot()).to).toBe(inboxFor("health"));
    expect(inboxFor("health")).toBe("allensforever711+health@gmail.com");
  });
});
