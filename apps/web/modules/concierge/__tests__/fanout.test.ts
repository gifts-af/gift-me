// @vitest-environment node
import type { ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { planJobs, type QueuedJob, type SendJobs } from "../rounds/fanout";
import { runRoundJob, runTick, type EngineDeps, type EngineZinc, type GenerateIdeas } from "../rounds/engine";
import type { DueRound } from "../rounds/store";
import { FakeRoundStore, type FakeRound } from "./fake-round-store";
import { FakeStore } from "./fake-store";
import { strayKeys } from "@/test/fanout-event-keys";

vi.mock("server-only", () => ({}));

const NOW = new Date("2027-02-11T12:00:00Z");
const due = (id: string, userId: string, status: DueRound["status"], deadline = "2027-03-11"): DueRound => ({
  id,
  userId,
  status,
  attentionReason: null,
  shipByDeadline: deadline,
});

describe("planJobs", () => {
  const list = [
    due("h1", "A", "needs_attention", "2027-03-01"),
    due("h2", "B", "needs_attention", "2027-03-02"),
    due("h3", "A", "needs_attention", "2027-03-03"),
    due("r1", "A", "awaiting_approval"),
    due("r2", "C", "scheduled"),
  ];

  it("groups held rounds per buyer in due order and sends the others one each", () => {
    const jobs = planJobs(list, true, NOW, false);
    expect(jobs.map((j) => j.idempotencyKey)).toEqual([
      "buyer:A:2027-02-11",
      "buyer:B:2027-02-11",
      "round:r1:2027-02-11",
      "round:r2:2027-02-11",
    ]);
    expect(jobs[0]!.message).toEqual({ kind: "buyer", userId: "A", roundIds: ["h1", "h3"] });
    expect(jobs[2]!.message).toEqual({ kind: "round", roundId: "r1" });
  });

  it("puts every held round of one buyer in one message, no cap", () => {
    const sixty = Array.from({ length: 60 }, (_, i) => due(`h${i}`, "A", "needs_attention"));
    const jobs = planJobs(sixty, true, NOW, false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.message).toMatchObject({ kind: "buyer", roundIds: sixty.map((r) => r.id) });
  });

  it("sends only buyer messages when the engine is off", () => {
    expect(planJobs(list, false, NOW, false).map((j) => j.message.kind)).toEqual(["buyer", "buyer"]);
  });

  it("puts now on messages only on a test clock", () => {
    expect(planJobs(list, true, NOW, false).some((j) => "now" in j.message)).toBe(false);
    expect(planJobs(list, true, NOW, true).every((j) => j.message.now === NOW.toISOString())).toBe(true);
  });
});

const SCHEDULE: ScheduleSettings = {
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

describe("runTick with fan-out", () => {
  let log: MockInstance;
  let store: FakeRoundStore;
  let calls: string[];
  let sent: QueuedJob[][];
  let sendJobs: ReturnType<typeof vi.fn<SendJobs>>;
  let emails: unknown[];

  const events = () =>
    log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string } & Record<string, unknown>);

  const deps = (over: Partial<EngineDeps> = {}): EngineDeps => ({
    store,
    notify: {
      store: new FakeStore(),
      channels: [{ name: "email", send: async (e) => (emails.push(e), { ok: true as const, id: "m" }) }],
      baseUrl: "https://giftsaf.test",
      now: NOW,
    },
    now: NOW,
    generateIdeas: async () => ({ status: "saved", count: 0 }),
    zinc: { sweep: async () => void calls.push("sweep") } as unknown as EngineDeps["zinc"],
    clearUnfiledNotes: async () => (calls.push("notes"), { cleared: 0, imagesRemoved: 0 }),
    sendJobs,
    ...over,
  });

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    calls = [];
    sent = [];
    emails = [];
    store = new FakeRoundStore();
    store.schedule = SCHEDULE;
    for (const [k, v] of Object.entries({
      round_engine_enabled: 1,
      round_fanout_enabled: 1,
      round_lock_minutes: 10,
      round_max_attempts: 3,
      zinc_place_budget_ms: 45_000,
      tick_deadline_ms: 270_000,
      idea_rounds_per_tick: 5,
    })) store.settings.set(k, v);
    store.candidateRows = [
      { userId: "U", personId: "P", occasionId: "O", rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: 5000 },
    ];
    store.people.set("P", { name: "Zelda", hasAddress: true });
    store.occasionKinds.set("O", "birthday");
    // Two held rounds (two buyers) and two ordinary ones: four messages.
    for (const [i, user] of ["U1", "U4", "U2", "U3"].entries()) {
      store.rounds.push({
        id: `x${i}`,
        userId: user,
        personId: `p${i}`,
        occasionId: `o${i}`,
        occasionYear: 2027,
        occasionDate: "2027-04-01",
        shipByDeadline: `2027-03-0${i + 1}`,
        budgetCents: 5000,
        late: false,
        status: i < 2 ? "needs_attention" : "awaiting_approval",
        nextActionAt: NOW,
        headsUpOn: null,
        lockedUntil: null,
        attempts: 0,
        history: [],
      });
    }
    sendJobs = vi.fn<SendJobs>(async (jobs) => (calls.push("send"), sent.push(jobs), { sent: jobs.length, failed: 0 }));
    vi.spyOn(store, "roundsWithRejectedAddresses").mockImplementation(async () => (calls.push("rejections"), []));
    vi.spyOn(store, "insertRound").mockImplementation(async () => (calls.push("create"), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it("does the housekeeping first, then sends due rounds, and claims and emails nothing", async () => {
    const claimDue = vi.spyOn(store, "claimDue");
    const claimMoney = vi.spyOn(store, "claimDueMoney");
    const summary = await runTick(deps());
    expect(calls).toEqual(["sweep", "notes", "create", "rejections", "send"]);
    expect(claimDue).not.toHaveBeenCalled();
    expect(claimMoney).not.toHaveBeenCalled();
    expect(emails).toEqual([]);
    expect(events()).toContainEqual(expect.objectContaining({ event: "round_fanout", enabled: true, due: 4, sent: 4, failed: 0 }));
    expect(summary).toEqual({ enabled: true, created: 1, advanced: 0, failed: 0 });
  });

  it("alerts when sends fail, and the rounds stay due", async () => {
    sendJobs.mockResolvedValue({ sent: 1, failed: 2 });
    const summary = await runTick(deps());
    expect(events()).toContainEqual(expect.objectContaining({ event: "round_fanout_send_failed", count: 2, alert: true }));
    expect(summary.failed).toBe(2);
    expect((await store.dueRounds(NOW)).length).toBe(4);
  });

  it("makes identical keys on two ticks the same day", async () => {
    await runTick(deps());
    await runTick(deps({ now: new Date("2027-02-11T18:00:00Z") }));
    expect(sent[0]!.map((j) => j.idempotencyKey)).toEqual(sent[1]!.map((j) => j.idempotencyKey));
  });

  it("runs today's path and logs once when the switch can't be read", async () => {
    store.settings.delete("round_fanout_enabled");
    await runTick(deps());
    expect(sendJobs).not.toHaveBeenCalled();
    expect(events().filter((e) => e.event === "round_fanout_setting_unreadable")).toHaveLength(1);
    expect(events().some((e) => e.event === "round_tick")).toBe(true);
  });

  it("logs only ids, counts, flags and enums (AC-17, E6)", async () => {
    await runTick(deps());
    sendJobs.mockResolvedValue({ sent: 1, failed: 2 });
    await runTick(deps());
    store.settings.delete("round_fanout_enabled");
    await runTick(deps());
    const mine = events().filter((e) => e.event.startsWith("round_fanout"));
    expect(new Set(mine.map((e) => e.event))).toEqual(
      new Set(["round_fanout", "round_fanout_send_failed", "round_fanout_setting_unreadable"]),
    );
    expect(strayKeys(mine)).toEqual([]);
  });

  it("runs today's path when the switch is 0 or there is no sendJobs", async () => {
    store.settings.set("round_fanout_enabled", 0);
    await runTick(deps());
    store.settings.set("round_fanout_enabled", 1);
    await runTick(deps({ sendJobs: undefined }));
    expect(sendJobs).not.toHaveBeenCalled();
    expect(events().filter((e) => e.event === "round_fanout")).toHaveLength(0);
  });
});

describe("runRoundJob", () => {
  let log: MockInstance;
  let store: FakeRoundStore;
  let emails: { subject: string }[];
  let clockMs: number;
  let placeRound: ReturnType<typeof vi.fn<EngineZinc["placeRound"]>>;
  let generateIdeas: ReturnType<typeof vi.fn<GenerateIdeas>>;

  const events = () =>
    log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string } & Record<string, unknown>);
  const jobEvents = () => events().filter((e) => e.event === "round_job");

  const notifyStore = () => {
    const s = new FakeStore();
    s.recipients.set("U1", { email: "buyer@example.com", timezone: null });
    return s;
  };
  const deps = (over: Partial<EngineDeps> = {}): EngineDeps => ({
    store,
    notify: {
      store: notifyStore(),
      channels: [{ name: "email", send: async (e) => (emails.push(e), { ok: true as const, id: "m" }) }],
      baseUrl: "https://giftsaf.test",
      now: NOW,
    },
    now: NOW,
    generateIdeas,
    clock: () => clockMs,
    zinc: {
      placeRound,
      sweep: async () => {},
      wallet: async () => ({ balanceCents: null, autoTopUp: null }),
      lookahead: async () => ({ cents: 0, atLeast: false }),
      walletUrl: "https://zinc.test/wallet",
    },
    ...over,
  });

  /** A round due now; held ones wait on a retry (placeable, no email first). */
  function addRound(id: string, over: Partial<FakeRound> = {}): FakeRound {
    const r: FakeRound = {
      id,
      userId: "U1",
      personId: "P",
      occasionId: "O",
      occasionYear: 2027,
      occasionDate: "2027-03-20",
      shipByDeadline: "2027-03-11",
      budgetCents: 5000,
      late: false,
      status: "needs_attention",
      attentionReason: "retry",
      nextActionAt: new Date("2027-02-11T00:00:00Z"),
      headsUpOn: "2027-01-01",
      lockedUntil: null,
      attempts: 0,
      history: [],
      ...over,
    };
    store.rounds.push(r);
    return r;
  }

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    emails = [];
    clockMs = 1_000;
    store = new FakeRoundStore();
    store.schedule = SCHEDULE;
    for (const [k, v] of Object.entries({
      round_engine_enabled: 1,
      round_fanout_enabled: 1,
      round_lock_minutes: 10,
      round_max_attempts: 3,
      zinc_place_budget_ms: 45_000,
      zinc_ordering_enabled: 1,
      tick_deadline_ms: 270_000,
      idea_rounds_per_tick: 5,
      idea_ai_timeout_ms: 60_000,
      idea_zinc_timeout_ms: 15_000,
    })) store.settings.set(k, v);
    store.people.set("P", { name: "Zelda", hasAddress: true });
    store.people.set("P2", { name: "Yara", hasAddress: true });
    store.occasionKinds.set("O", "birthday");
    // The money path's SQL (reconcile_round) isn't in the fake: the round keeps its status.
    vi.spyOn(store, "reconcile").mockImplementation(async (...args: unknown[]) => store.round(String(args[0])).status);
    placeRound = vi.fn<EngineZinc["placeRound"]>(async () => {});
    generateIdeas = vi.fn<GenerateIdeas>(async (round) => {
      store.ideas.set(round.id, [{ title: "Mug", totalCents: 4200 }]);
      return { status: "saved", count: 1 };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is off when the fan-out switch is 0, and claims nothing (review focus 5)", async () => {
    addRound("h1");
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    const claim = vi.spyOn(store, "claim");
    store.settings.set("round_fanout_enabled", 0);
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps())).toBe("off");
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("off");
    expect(claim).not.toHaveBeenCalled();
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("throws when the fan-out switch can't be read, so the queue redelivers, and claims nothing", async () => {
    addRound("h1");
    const claim = vi.spyOn(store, "claim");
    store.settings.delete("round_fanout_enabled");
    await expect(runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).rejects.toThrow();
    await expect(runRoundJob({ kind: "round", roundId: "h1" }, deps())).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("throws when a setting read fails before any claim, so the queue redelivers and no lease is held", async () => {
    addRound("h1");
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    const claim = vi.spyOn(store, "claim");
    const schedule = vi.spyOn(store, "scheduleSettings").mockRejectedValue(new Error("db down"));
    await expect(runRoundJob({ kind: "round", roundId: "r1" }, deps())).rejects.toThrow("db down");
    await expect(runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).rejects.toThrow("db down");
    schedule.mockRestore();
    // The engine switch and the placing deadline, read before the buyer's claims too.
    store.settings.delete("zinc_place_budget_ms");
    await expect(runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).rejects.toThrow();
    store.settings.set("zinc_place_budget_ms", 45_000);
    store.settings.delete("round_engine_enabled");
    await expect(runRoundJob({ kind: "round", roundId: "r1" }, deps())).rejects.toThrow();
    await expect(runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
    expect(store.round("r1").lockedUntil).toBeNull();
    expect(store.round("h1").lockedUntil).toBeNull();
    expect(placeRound).not.toHaveBeenCalled();
    // No round_job event of its own: handleJob logs the alert as it rethrows.
    expect(jobEvents()).toEqual([]);
  });

  it("is failed, not thrown, when something fails after a round was claimed (the next tick picks it up)", async () => {
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    vi.spyOn(store, "roundContext").mockRejectedValue(new Error("database down"));
    await expect(runRoundJob({ kind: "round", roundId: "r1" }, deps())).resolves.toBe("failed");
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "round", result: "failed", round_id: "r1" })]);
  });

  it("with the engine off, a round message is off and a buyer message still places its held round", async () => {
    addRound("h1");
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    store.settings.set("round_engine_enabled", 0);
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps())).toBe("off");
    expect(store.round("r1").attempts).toBe(0);
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("advanced");
    expect(placeRound).toHaveBeenCalledTimes(1);
    expect(placeRound.mock.calls[0]![2]).toBe(1_000 + 45_000);
    expect(store.round("h1").lockedUntil).toBeNull();
    expect(jobEvents()).toContainEqual(expect.objectContaining({ kind: "buyer", result: "advanced", user_id: "U1", rounds: 1 }));
  });

  it("is busy for a round an approval holds, and sends nothing (AC-4)", async () => {
    addRound("r1", {
      status: "awaiting_approval",
      attentionReason: null,
      headsUpOn: "2027-02-06",
      lockedUntil: new Date(NOW.getTime() + 60_000),
    });
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps())).toBe("busy");
    expect(emails).toEqual([]);
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "round", result: "busy", round_id: "r1", rounds: 0 })]);
  });

  it.each(["ordered", "skipped"] as const)("is busy for a held round %s since the tick, and places nothing (review focus 1)", async (status) => {
    addRound("h1", { status, nextActionAt: null, attentionReason: null });
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("busy");
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("gives back a round message's round that became held since the tick, for the buyer message", async () => {
    addRound("h1");
    expect(await runRoundJob({ kind: "round", roundId: "h1" }, deps())).toBe("busy");
    expect(placeRound).not.toHaveBeenCalled();
    expect(store.writes).toContain("release:h1");
    expect(store.round("h1")).toMatchObject({ lockedUntil: null, status: "needs_attention" });
  });

  it("runs the step of a buyer message's round that left the money path (a reminder due)", async () => {
    addRound("h1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("advanced");
    expect(emails).toHaveLength(1);
    expect([...store.sends.get("h1")!]).toEqual(["reminder_1"]);
  });

  it("gives back a buyer message's round that left the money path when the engine is off", async () => {
    addRound("h1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    store.settings.set("round_engine_enabled", 0);
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("busy");
    expect(emails).toEqual([]);
    expect(store.round("h1").lockedUntil).toBeNull();
  });

  it("gives back a buyer message's round whose step is an idea run, for the next round message", async () => {
    addRound("h1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps())).toBe("busy");
    expect(generateIdeas).not.toHaveBeenCalled();
    expect(store.round("h1")).toMatchObject({ status: "scheduled", lockedUntil: null });
  });

  it("sends a due reminder once and finishes the round with its next date", async () => {
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps())).toBe("advanced");
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps())).toBe("busy");
    expect(emails).toHaveLength(1);
    // Reminder 2 is 7 days before the 03-11 deadline.
    expect(store.round("r1")).toMatchObject({
      status: "awaiting_approval",
      nextActionAt: new Date("2027-03-04T00:00:00Z"),
      lockedUntil: null,
    });
    expect(jobEvents()[0]).toMatchObject({ kind: "round", result: "advanced", round_id: "r1", rounds: 1 });
  });

  it("runs one idea run with a signal ending at job start plus tick_deadline_ms, even with idea_rounds_per_tick 0", async () => {
    store.settings.set("idea_rounds_per_tick", 0);
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    // The job starts at 1 000 ms; everything after reads 6 000 ms.
    let first = true;
    const clock = () => (first ? ((first = false), 1_000) : 6_000);
    expect(await runRoundJob({ kind: "round", roundId: "r1" }, deps({ clock }))).toBe("advanced");
    expect(generateIdeas).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(1_000 + 270_000 - 6_000);
    expect(store.round("r1").status).toBe("awaiting_approval");
    expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
  });

  it("runs the step as the tick would when the person was deleted since the tick (review focus 2)", async () => {
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06", personId: "gone" });
    await expect(runRoundJob({ kind: "round", roundId: "r1" }, deps())).resolves.toBe("failed");
    expect(events()).toContainEqual(expect.objectContaining({ event: "round_failed", round_id: "r1" }));
    expect(jobEvents()).toEqual([expect.objectContaining({ result: "failed", rounds: 0 })]);
  });

  it("gives each buyer's message its own placing budget (AC-7)", async () => {
    addRound("h1", { userId: "A" });
    addRound("h2", { userId: "B", personId: "P2" });
    placeRound.mockImplementation(async () => void (clockMs += 40_000));
    expect(await runRoundJob({ kind: "buyer", userId: "A", roundIds: ["h1"] }, deps())).toBe("advanced");
    expect(await runRoundJob({ kind: "buyer", userId: "B", roundIds: ["h2"] }, deps())).toBe("advanced");
    expect(placeRound.mock.calls.map((c) => c[0])).toEqual(["h1", "h2"]);
    expect(events().some((e) => e.event === "order.place_budget_spent")).toBe(false);
  });

  it("is failed when one of a buyer's rounds fails, counting the one that advanced", async () => {
    addRound("h1");
    addRound("h2");
    const real = store.roundContext.bind(store);
    vi.spyOn(store, "roundContext").mockImplementation(async (id: string) => {
      if (id === "h2") throw new Error("database down");
      return real(id);
    });
    expect(await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1", "h2"] }, deps())).toBe("failed");
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "buyer", result: "failed", user_id: "U1", rounds: 1 })]);
  });

  it("logs only ids, counts, flags and enums (AC-17, E6)", async () => {
    addRound("h1");
    addRound("h2");
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    addRound("r2", { status: "scheduled", attentionReason: null, headsUpOn: null });
    await runRoundJob({ kind: "round", roundId: "r1" }, deps());
    await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h1"] }, deps());
    // The daily limit.
    generateIdeas.mockResolvedValueOnce({ status: "refused", reason: "daily_limit" });
    await runRoundJob({ kind: "round", roundId: "r2" }, deps());
    // A failure carries the error's fields, never its message.
    vi.spyOn(store, "roundContext").mockRejectedValue(Object.assign(new Error("Zelda at 1 Main St"), { code: "57P01" }));
    await runRoundJob({ kind: "buyer", userId: "U1", roundIds: ["h2"] }, deps());
    // Off.
    store.settings.set("round_fanout_enabled", 0);
    await runRoundJob({ kind: "round", roundId: "r1" }, deps());
    const mine = events().filter((e) => e.event === "round_job" || e.event === "ideas.daily_limit_reached");
    expect(mine.map((e) => e.event)).toContain("ideas.daily_limit_reached");
    expect(mine.filter((e) => e.result === "failed")).toHaveLength(1);
    expect(strayKeys(mine)).toEqual([]);
    expect(JSON.stringify(mine)).not.toMatch(/Zelda|Main St/);
  });
});
