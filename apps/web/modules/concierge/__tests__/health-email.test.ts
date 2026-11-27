import { describe, expect, it } from "vitest";
import { inboxFor } from "@/lib/brand";
import { buildHealthEmail, RUNBOOK_ANCHORS } from "../health/email";
import { healthReport, type ProblemKind } from "../health/report";
import { costs, MONDAY, settings, snapshot, TUESDAY, vendors } from "./health-fixtures";

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

  it("AC-17 and AC-18: the rows name the vendor and count the failed runs", () => {
    const report = healthReport(
      snapshot({ failedRuns: 1 }),
      { ...vendors, aiCreditCents: null, aiFailed: true },
      { ...settings, ideaEngineEnabled: true },
      TUESDAY,
    );
    const email = buildHealthEmail(report, BASE);
    const rows = email.text.split("\n").filter((l) => l.startsWith("- "));
    expect(rows[0]).toContain("Gift ideas failed (1 idea run failed in the last day)");
    expect(rows[1]).toContain("A vendor check failed (The AI Gateway balance couldn't be read)");
  });

  it("every row's link is runbookBase#RUNBOOK_ANCHORS[kind]", () => {
    const every = healthReport(
      snapshot({
        noCreditRuns: 1,
        failedRuns: 1,
        stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }],
        unconfirmed: [{ orderId: "o1", roundId: "r2", userId: "u1" }],
        placingStale: [{ orderId: "o2", roundId: "r3", userId: "u1" }],
        heldZinc: [{ orderId: "o3", roundId: "r4", userId: "u1", holdReason: "retry" }],
        deadlineClose: [{ roundId: "r5", userId: "u1", reason: "funds", shipByDeadline: "2026-12-01" }],
        overMaxCharge: [{ orderId: "o6", roundId: "r6", userId: "u1", chargeCents: 2565, maxChargeCents: 2564 }],
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
    // The heading says All clear; the body line doesn't repeat it.
    expect(e.text).toContain("Nothing needs you.");
    expect(e.text).not.toContain("All clear: nothing");
    expect(e.text).toContain("1 waiting on an address");
    expect(e.text).toContain("1 waiting on funds");
    expect(e.text).toContain("2 failed captures");
  });

  it("AC-9: the cost rows come after the problems, and only when there are costs", () => {
    const report = healthReport(snapshot({ stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }] }), vendors, settings, MONDAY);
    const rows = (r: typeof report) => buildHealthEmail(r, BASE).text.split("\n").filter((l) => l.startsWith("- "));
    const without = rows(report);
    expect(without).toHaveLength(1);
    expect(rows({ ...report, costs: null })).toEqual(without);

    const withCosts = rows({ ...report, costs: costs() });
    expect(withCosts[0]).toEqual(without[0]);
    expect(withCosts).toHaveLength(7);
    expect(withCosts[1]).toBe("- Cost per completed gift (Counted since Nov 25, 2026. 12 completed gifts)");
    expect(withCosts[6]).toBe("- QA account: $0.42 (Not counted above)");
  });

  it("AC-11: unreadable costs are one row, and nothing else changes", () => {
    const report = healthReport(snapshot({ stuckRounds: [{ roundId: "r1", userId: "u1", attempts: 3 }] }), vendors, settings, MONDAY);
    const line = "- Cost per completed gift (Costs couldn't be read)\n";
    const plain = buildHealthEmail(report, BASE);
    const broken = buildHealthEmail({ ...report, costs: "unreadable" }, BASE);
    expect(broken.subject).toBe(plain.subject);
    expect(broken.text).toContain(line);
    expect(broken.text.replace(line, "")).toBe(plain.text);
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

  it("a card charged over its maximum names the order and both amounts, and links the alert's runbook row", () => {
    const email = build(snapshot({ overMaxCharge: [{ orderId: "o6", roundId: "r6", userId: "u1", chargeCents: 2565, maxChargeCents: 2564 }] }));
    expect(email.text).toContain("- A card was charged more than the most shown (round r6, order o6, user u1: charged $25.65, most shown $25.64)");
    expect(RUNBOOK_ANCHORS.over_max_charge).toBe("alerts-events-with-alert-true");
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
