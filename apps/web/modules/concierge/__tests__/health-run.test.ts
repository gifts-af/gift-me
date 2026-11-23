// runHealthCheck's own decisions, on clients that throw or answer from a table. The real
// database's side of the same calls is in health-db.test.ts (E5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthDeps } from "../health/run";
import type { OutgoingEmail } from "@/lib/resend";

vi.mock("server-only", () => ({}));
const { runHealthCheck } = await import("../health/run");

const TUESDAY = new Date("2026-11-24T14:00:00Z");
let log: { mock: { calls: unknown[][] } };
const events = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/**
 * A client that can't reach the database: every query throws (as when the network is down), or
 * comes back with supabase-js's `{ error }` (as when Supabase answers but Postgres doesn't).
 */
function downDb(how: "throws" | "errors") {
  const calls: string[] = [];
  const failure = () => {
    const e = new Error("connect ECONNREFUSED 10.0.0.1:5432 for jordan@example.com");
    return Object.assign(e, { code: "ECONNREFUSED" });
  };
  const fail = (what: string) => () => {
    calls.push(what);
    if (how === "throws") throw failure();
    const answer = { data: null, error: { message: failure().message, code: "ECONNREFUSED" } };
    // The ping's builder chain, ending in the reply.
    return { select: () => ({ limit: async () => answer }) };
  };
  const db = {
    schema: () => ({ from: fail("from"), rpc: fail("rpc") }),
    from: fail("from"),
    rpc: fail("rpc"),
  } as unknown as HealthDeps["db"];
  return { db, calls };
}

const SETTINGS: Record<string, number> = {
  health_email_enabled: 1,
  health_all_clear_weekday: 1,
  ai_credit_low_cents: 500,
  zinc_app_balance_low_cents: 500,
  idea_engine_enabled: 0,
  capture_extraction_enabled: 0,
  health_vendor_timeout_ms: 10000,
};

const SNAPSHOT = {
  tick: {
    last_ok_finished_at: "2026-11-24T12:04:00Z",
    today: { started_at: "2026-11-24T12:00:00Z", finished_at: "2026-11-24T12:04:00Z", result: "ok", rounds_failed: 0, fanout_failed: 0 },
  },
  no_credit_runs: 0,
  stuck_rounds: [{ round_id: "r1", user_id: "u1", attempts: 3 }],
  unconfirmed: [],
  placing_stale: [],
  held_zinc: [],
  deadline_close: [],
  ideas_waiting: [],
  weekly: { waiting_address: 0, waiting_funds: 0, waiting_setup: 0, waiting_approval: 0, no_ideas: 0, rounds_failed: 0, failed_captures: 0 },
};

/** A client that answers the ping, setting_int from SETTINGS and health_snapshot with SNAPSHOT. */
function upDb() {
  const concierge = {
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async (fn: string, args: { p_key?: string }) =>
      fn === "setting_int" ? { data: SETTINGS[args.p_key!] ?? null, error: null } : { data: SNAPSHOT, error: null },
  };
  return { schema: () => concierge } as unknown as HealthDeps["db"];
}

function deps(over: Partial<HealthDeps> = {}): HealthDeps & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    db: upDb(),
    now: TUESDAY,
    send: async (e) => {
      sent.push(e);
      return { ok: true, id: "em_1" };
    },
    aiCredits: async () => 5000,
    zincBalance: async () => 5000,
    aiConfigured: true,
    zincConfigured: true,
    runbookBase: "https://example.test/operations.md",
    sent,
    ...over,
  };
}

describe("runHealthCheck", () => {
  it.each(["throws", "errors"] as const)("AC-8: retries once, sends the db_down email, reads no setting, and the event holds errorFields only (a client that %s)", async (how) => {
    const { db, calls } = downDb(how);
    const d = deps({ db });
    const out = await runHealthCheck(d);

    expect(out).toEqual({ result: "db_down", problems: 1 });
    // Two pings, and no setting_int (an rpc) at all.
    expect(calls).toEqual(["from", "from"]);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].subject).toContain("1 thing needs you");
    expect(d.sent[0].text).toContain("The database can't be reached");
    expect(d.sent[0].text).not.toContain("ECONNREFUSED 10.0.0.1");

    expect(events().find((e) => e.event === "health.checked")).toEqual({
      event: "health.checked",
      at: expect.any(String),
      result: "db_down",
      problems: 1,
      sent: true,
      weekly: false,
      // A supabase-js error is a plain object, so it has no Error name.
      name: how === "throws" ? "Error" : "unknown",
      code: "ECONNREFUSED",
    });
    expect(JSON.stringify(events())).not.toContain("jordan@example.com");
  });

  it("a failed send logs health.send_failed with alert", async () => {
    const d = deps({ send: async () => ({ ok: false, error: "Resend responded 403" }) });
    const out = await runHealthCheck(d);

    expect(out).toEqual({ result: "send_failed", problems: 1 });
    const failed = events().find((e) => e.event === "health.send_failed");
    expect(failed).toMatchObject({ alert: true });
    expect(JSON.stringify(failed)).not.toContain("Resend responded");
    expect(events().find((e) => e.event === "health.checked")).toMatchObject({ result: "send_failed", problems: 1, sent: false });
  });

  it("a vendor call that throws is logged and the rest still runs", async () => {
    const boom = Object.assign(new Error("gateway said: key sk-live-123 refused"), { status: 503 });
    const aiCredits = vi.fn(async () => {
      throw boom;
    });
    const zincBalance = vi.fn(async () => 100);
    const d = deps({ aiCredits, zincBalance });
    const out = await runHealthCheck(d);

    // Each vendor call gets health_vendor_timeout_ms, so a hung one can't outlast the route.
    expect(aiCredits).toHaveBeenCalledWith(10000);
    expect(zincBalance).toHaveBeenCalledWith(10000);

    expect(out).toEqual({ result: "sent", problems: 2 });
    const vendorEvents = events().filter((e) => e.event === "health.vendor_check_failed");
    expect(vendorEvents).toHaveLength(1);
    expect(vendorEvents[0]).toEqual({ event: "health.vendor_check_failed", at: expect.any(String), vendor: "ai_gateway", name: "Error", status: 503 });
    // The stuck round and the low Zinc balance still reach the email.
    expect(d.sent[0].text).toContain("A round is stuck");
    expect(d.sent[0].text).toContain("The app's Zinc balance is low");
  });

  it.each(["ai_credit_low_cents", "health_vendor_timeout_ms"])("a setting that can't be read (%s) fails loudly, and nothing is called or sent", async (key) => {
    const was = SETTINGS[key];
    delete SETTINGS[key];
    try {
      const aiCredits = vi.fn(async () => 5000);
      const d = deps({ aiCredits });
      expect(await runHealthCheck(d)).toEqual({ result: "failed", problems: 0 });
      expect(aiCredits).not.toHaveBeenCalled();
      expect(d.sent).toHaveLength(0);
      expect(events().find((e) => e.event === "health.checked")).toMatchObject({ result: "failed", alert: true });
    } finally {
      SETTINGS[key] = was;
    }
  });

  it("no vendor function means no call: the balance is null and nothing is flagged for it", async () => {
    SNAPSHOT.stuck_rounds = [];
    try {
      const d = deps({ aiCredits: null, zincBalance: null });
      expect(await runHealthCheck(d)).toEqual({ result: "quiet", problems: 0 });
      expect(d.sent).toHaveLength(0);
      expect(events().filter((e) => e.event === "health.vendor_check_failed")).toHaveLength(0);
    } finally {
      SNAPSHOT.stuck_rounds = [{ round_id: "r1", user_id: "u1", attempts: 3 }];
    }
  });
});
