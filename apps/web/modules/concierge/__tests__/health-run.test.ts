// runHealthCheck's own decisions, on clients that throw or answer from a table. The real
// database's side of the same calls is in health-db.test.ts (E5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthDeps } from "../health/run";
import type { OutgoingEmail } from "@/lib/resend";
import { costs, MONDAY } from "./health-fixtures";

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
  amazon_paste_lookup_enabled: 1,
  health_vendor_timeout_ms: 10000,
  health_launch_numbers: 0,
};

const SNAPSHOT = {
  tick: {
    last_ok_finished_at: "2026-11-24T12:04:00Z",
    today: { started_at: "2026-11-24T12:00:00Z", finished_at: "2026-11-24T12:04:00Z", result: "ok", rounds_failed: 0, fanout_failed: 0 },
  },
  no_credit_runs: 0,
  failed_runs: 0,
  stuck_rounds: [{ round_id: "r1", user_id: "u1", attempts: 3 }],
  unconfirmed: [],
  placing_stale: [],
  held_zinc: [],
  deadline_close: [],
  ideas_waiting: [],
  weekly: { waiting_address: 0, waiting_funds: 0, waiting_setup: 0, waiting_approval: 0, no_ideas: 0, rounds_failed: 0, failed_captures: 0 },
};

const pair = (day: number, total: number) => ({ day, total });
const LAUNCH = {
  signups: pair(2, 5),
  lists_started: pair(1, 3),
  gifts_added: pair(9, 40),
  lists_followed: pair(0, 1),
  gifts_claimed: pair(0, 2),
  people_added: pair(1, 4),
};

/** How cost_per_gift answers. */
type CostReply = (signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>;

/**
 * A client that answers the ping, setting_int from SETTINGS and health_snapshot with SNAPSHOT,
 * or with an error whose text must never reach the email or the logs.
 */
function upDb(snapshotFails = false, costReply: CostReply | null = null, launchFails = false) {
  const snapshotError = { message: "column r.updated_at does not exist near jordan@example.com", code: "42703" };
  const concierge = {
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: (fn: string, args: { p_key?: string }) => {
      if (fn === "launch_numbers") {
        return Promise.resolve(launchFails ? { data: null, error: { message: "launch numbers failed for jordan@example.com" } } : { data: LAUNCH, error: null });
      }
      if (fn === "cost_per_gift") {
        if (!costReply) throw new Error("no cost reply for jordan@example.com");
        return { abortSignal: costReply };
      }
      return Promise.resolve(
        fn === "setting_int"
          ? { data: SETTINGS[args.p_key!] ?? null, error: null }
          : snapshotFails
            ? { data: null, error: snapshotError }
            : { data: SNAPSHOT, error: null },
      );
    },
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

    // The two tries share health_vendor_timeout_ms, so a hung vendor can't outlast the route.
    expect(aiCredits).toHaveBeenNthCalledWith(1, 5000);
    expect(aiCredits).toHaveBeenNthCalledWith(2, 5000);
    expect(zincBalance).toHaveBeenCalledWith(5000);

    expect(out).toEqual({ result: "sent", problems: 2 });
    const vendorEvents = events().filter((e) => e.event === "health.vendor_check_failed");
    expect(vendorEvents).toHaveLength(1);
    expect(vendorEvents[0]).toEqual({ event: "health.vendor_check_failed", at: expect.any(String), vendor: "ai_gateway", name: "Error", status: 503 });
    // The stuck round and the low Zinc balance still reach the email.
    expect(d.sent[0].text).toContain("A round is stuck");
    expect(d.sent[0].text).toContain("The app's Zinc balance is low");
  });

  it("AC-17: while AI is in use, a check that fails twice is emailed and logged once", async () => {
    SETTINGS.idea_engine_enabled = 1;
    try {
      const aiCredits = vi.fn(async () => {
        throw Object.assign(new Error("key sk-live-123 refused"), { status: 401 });
      });
      const d = deps({ aiCredits });
      expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 2 });
      expect(aiCredits).toHaveBeenCalledTimes(2);
      expect(d.sent[0].text).toContain("The AI Gateway balance couldn't be read");
      expect(d.sent[0].text).not.toContain("sk-live-123");
      expect(events().filter((e) => e.event === "health.vendor_check_failed")).toEqual([
        { event: "health.vendor_check_failed", at: expect.any(String), vendor: "ai_gateway", name: "Error", status: 401 },
      ]);
    } finally {
      SETTINGS.idea_engine_enabled = 0;
    }
  });

  it("a vendor check that works on its second try is not a problem", async () => {
    SETTINGS.idea_engine_enabled = 1;
    try {
      const aiCredits = vi.fn(async () => 5000).mockRejectedValueOnce(new Error("blip"));
      const d = deps({ aiCredits });
      expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 1 });
      expect(aiCredits).toHaveBeenCalledTimes(2);
      expect(events().filter((e) => e.event === "health.vendor_check_failed")).toEqual([]);
    } finally {
      SETTINGS.idea_engine_enabled = 0;
    }
  });

  it.each(["ai_credit_low_cents", "health_vendor_timeout_ms", "health_email_enabled"])(
    "a setting that can't be read (%s) fails loudly: no vendor call, one fixed email with the stage settings",
    async (key) => {
      const was = SETTINGS[key];
      delete SETTINGS[key];
      try {
        const aiCredits = vi.fn(async () => 5000);
        const d = deps({ aiCredits });
        expect(await runHealthCheck(d)).toEqual({ result: "failed", problems: 1 });
        expect(aiCredits).not.toHaveBeenCalled();
        expect(d.sent).toHaveLength(1);
        expect(d.sent[0].text).toContain("The health check couldn't run");
        expect(d.sent[0].text).toContain("Stopped at: settings");
        expect(events().find((e) => e.event === "health.checked")).toMatchObject({ result: "failed", stage: "settings", sent: true, alert: true });
      } finally {
        SETTINGS[key] = was;
      }
    },
  );

  it("a snapshot that errors sends one fixed email with the stage and no error text, and logs the stage", async () => {
    const d = deps({ db: upDb(true) });
    expect(await runHealthCheck(d)).toEqual({ result: "failed", problems: 1 });

    expect(d.sent).toHaveLength(1);
    const { subject, text, html } = d.sent[0];
    expect(subject).toContain("1 thing needs you");
    expect(text).toContain("The health check couldn't run");
    expect(text).toContain("Stopped at: snapshot");
    expect(html).toContain("#the-health-check-couldnt-run");
    for (const leak of ["updated_at", "jordan@example.com", "42703"]) {
      expect(text).not.toContain(leak);
      expect(html).not.toContain(leak);
    }
    const checked = events().find((e) => e.event === "health.checked");
    expect(checked).toMatchObject({ result: "failed", problems: 1, stage: "snapshot", sent: true, alert: true });
    expect(JSON.stringify(events())).not.toContain("jordan@example.com");
  });

  it("a failed check whose email is refused still logs the stage, with sent false", async () => {
    const d = deps({ db: upDb(true), send: async () => ({ ok: false, error: "Resend responded 403" }) });
    expect(await runHealthCheck(d)).toEqual({ result: "failed", problems: 1 });
    expect(events().find((e) => e.event === "health.checked")).toMatchObject({ result: "failed", stage: "snapshot", sent: false });
    expect(events().find((e) => e.event === "health.send_failed")).toMatchObject({ alert: true });
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

  describe("the costs", () => {
    const costRow = /^- Cost per completed gift.*$/m;

    it("AC-9: on a Monday they're read and shown", async () => {
      const read = vi.fn(async () => ({ data: costs(), error: null }));
      const d = deps({ db: upDb(false, read), now: MONDAY });
      expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 1 });
      expect(read).toHaveBeenCalledTimes(1);
      expect(d.sent[0].text).toContain("A round is stuck");
      expect(d.sent[0].text).toContain("- QA account: $0.42 (Not counted above)");
      expect(events().filter((e) => e.event === "health.costs_failed")).toEqual([]);
    });

    it("AC-11: on any other day they aren't read, even when an email goes out", async () => {
      const read = vi.fn(async () => ({ data: costs(), error: null }));
      const d = deps({ db: upDb(false, read) });
      expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 1 });
      expect(read).not.toHaveBeenCalled();
      expect(d.sent[0].text).not.toMatch(costRow);
    });

    it("tracking off shows no section and logs no failure", async () => {
      const d = deps({ db: upDb(false, async () => ({ data: null, error: null })), now: MONDAY });
      expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 1 });
      expect(d.sent[0].text).not.toMatch(costRow);
      expect(events().filter((e) => e.event === "health.costs_failed")).toEqual([]);
    });

    it.each<[string, Record<string, unknown>, CostReply | null]>([
      [
        "a query error",
        { code: "P0001" },
        async () => ({ data: null, error: { message: "row of jordan@example.com", details: "jordan@example.com", code: "P0001" } }),
      ],
      ["a client that throws", { name: "Error" }, null],
      ["a rejected read", { name: "Error" }, async () => Promise.reject(new Error("jordan@example.com refused"))],
      ["an answer in the wrong shape", { name: "ZodError" }, async () => ({ data: { ...costs(), gifts: "jordan@example.com" }, error: null })],
      [
        "a hung read",
        { name: "TimeoutError" },
        (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      ],
    ])("AC-11: %s leaves the rest of the email exactly as it was", async (_what, logged, reply) => {
      const was = SETTINGS.health_vendor_timeout_ms;
      SETTINGS.health_vendor_timeout_ms = 20;
      try {
        const good = deps({ db: upDb(false, async () => ({ data: null, error: null })), now: MONDAY });
        const goodResult = await runHealthCheck(good);
        const goodChecked = events().find((e) => e.event === "health.checked");
        log.mock.calls.length = 0;

        const d = deps({ db: upDb(false, reply), now: MONDAY });
        expect(await runHealthCheck(d)).toEqual(goodResult);
        expect(d.sent).toHaveLength(1);
        expect(d.sent[0].subject).toBe(good.sent[0].subject);
        const line = "- Cost per completed gift (Costs couldn't be read)\n";
        expect(d.sent[0].text).toContain(line);
        expect(d.sent[0].text.replace(line, "")).toBe(good.sent[0].text);

        const failed = events().filter((e) => e.event === "health.costs_failed");
        expect(failed).toEqual([expect.objectContaining(logged)]);
        // Never an alert: the costs aren't a problem the owner must act on.
        expect(failed[0]).not.toHaveProperty("alert");
        expect(events().find((e) => e.event === "health.checked")).toEqual({ ...goodChecked, at: expect.any(String) });
        expect(JSON.stringify(events())).not.toContain("jordan@example.com");
        expect(d.sent[0].html).not.toContain("jordan@example.com");
      } finally {
        SETTINGS.health_vendor_timeout_ms = was;
      }
    });
  });

  describe("the launch numbers", () => {
    const quietSnapshot = { ...SNAPSHOT, stuck_rounds: [] };
    const withLaunch = async (run: () => Promise<void>) => {
      const was = { launch: SETTINGS.health_launch_numbers, stuck: SNAPSHOT.stuck_rounds };
      SETTINGS.health_launch_numbers = 1;
      SNAPSHOT.stuck_rounds = quietSnapshot.stuck_rounds;
      try {
        await run();
      } finally {
        SETTINGS.health_launch_numbers = was.launch;
        SNAPSHOT.stuck_rounds = was.stuck;
      }
    };

    it("off, a quiet day sends nothing and never reads them", async () => {
      const d = deps();
      SNAPSHOT.stuck_rounds = [];
      try {
        expect(await runHealthCheck(d)).toEqual({ result: "quiet", problems: 0 });
      } finally {
        SNAPSHOT.stuck_rounds = [{ round_id: "r1", user_id: "u1", attempts: 3 }];
      }
      expect(d.sent).toHaveLength(0);
    });

    it("on, a quiet day still sends All clear with each number for the day and all time", () =>
      withLaunch(async () => {
        const d = deps();
        expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 0 });
        expect(d.sent).toHaveLength(1);
        expect(d.sent[0].subject).toContain("All clear");
        expect(d.sent[0].text).toContain("New signups");
        expect(d.sent[0].text).toContain("2 in the last day, 5 all time");
        expect(d.sent[0].text).toContain("9 in the last day, 40 all time");
      }));

    it("numbers that can't be read are one line, the email still goes, and the error text stays out", () =>
      withLaunch(async () => {
        const d = deps({ db: upDb(false, null, true) });
        expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 0 });
        expect(d.sent[0].text).toContain("The numbers couldn't be read");
        expect(d.sent[0].text).not.toContain("jordan@example.com");
        expect(events().some((e) => e.event === "health.launch_numbers_failed")).toBe(true);
      }));
  });
});
