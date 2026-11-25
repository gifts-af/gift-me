import type { ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { planJobs, retryJob, type QueuedJob, type RoundMessage, type SendJobs } from "../rounds/fanout";
import type { IdeaOutcome } from "../ideas/run";
import { runBuyerMessage, runRoundMessage, runTick, type EngineDeps, type EngineZinc, type GenerateIdeas, type JobResult, type StepDeps } from "../rounds/engine";
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
      // The buyer key ends with the first 12 hex of sha256 of the sorted round ids, comma-joined.
      "buyer:A:2027-02-11:2de267a78f52",
      "buyer:B:2027-02-11:f998fe06afa0",
      "round:r1:2027-02-11",
      "round:r2:2027-02-11",
    ]);
    expect(jobs[0]!.message).toEqual({ kind: "buyer", userId: "A", roundIds: ["h1", "h3"] });
    expect(jobs[2]!.message).toEqual({ kind: "round", roundId: "r1" });
  });

  it("gives a buyer the same key for the same held rounds in any order, and a new key when one more is held", () => {
    const key = (rounds: DueRound[]) => planJobs(rounds, true, NOW, false)[0]!.idempotencyKey;
    const a = due("h1", "A", "needs_attention");
    const b = due("h3", "A", "needs_attention");
    expect(key([a, b])).toBe(key([b, a]));
    // A same-day re-run that finds a newly held round sends it; an identical one still dedupes.
    expect(key([a, b, due("h9", "A", "needs_attention")])).not.toBe(key([a, b]));
    expect(key([a])).toMatch(/^buyer:A:2027-02-11:[0-9a-f]{12}$/);
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

describe("retryJob", () => {
  it("counts up from a message that was never put off, with its own key and delay", () => {
    expect(retryJob({ kind: "round", roundId: "r1" }, "2027-02-11", 300)).toEqual({
      message: { kind: "round", roundId: "r1", retry: 1 },
      idempotencyKey: "round:r1:2027-02-11:retry:1",
      delaySeconds: 300,
    });
  });

  it("counts on from 2 to 3", () => {
    const job = retryJob({ kind: "round", roundId: "r1", retry: 2 }, "2027-02-11", 300);
    expect(job.message).toMatchObject({ retry: 3 });
    expect(job.idempotencyKey).toBe("round:r1:2027-02-11:retry:3");
  });

  it("carries a test clock's now, and adds none", () => {
    const now = NOW.toISOString();
    expect(retryJob({ kind: "round", roundId: "r1", now }, "2027-02-11", 300).message).toEqual({ kind: "round", roundId: "r1", retry: 1, now });
    expect(retryJob({ kind: "round", roundId: "r1" }, "2027-02-11", 300).message).not.toHaveProperty("now");
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
    expect(summary).toEqual({ enabled: true, created: 1, advanced: 0, failed: 0, fanoutFailed: 0 });
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

// Checked by the type checker, never run: a round message can't reach the placing side.
void ((zinc: NonNullable<StepDeps["zinc"]>) => {
  // @ts-expect-error a round message never places a gift
  void zinc.placeRound;
  // @ts-expect-error nor settles orders left placing
  void zinc.sweep;
});

describe("runRoundMessage and runBuyerMessage", () => {
  let log: MockInstance;
  let store: FakeRoundStore;
  let emails: { subject: string }[];
  let clockMs: number;
  let placeRound: ReturnType<typeof vi.fn<EngineZinc["placeRound"]>>;
  let generateIdeas: ReturnType<typeof vi.fn<GenerateIdeas>>;
  let sendJobs: ReturnType<typeof vi.fn<SendJobs>>;

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

  const runMessage = (message: RoundMessage, over: Partial<EngineDeps> = {}) => runRoundMessage(message, { ...deps(over), sendJobs });
  const runRound = (roundId: string, over: Partial<EngineDeps> = {}) => runMessage({ kind: "round", roundId }, over);
  const runBuyer = (userId: string, roundIds: string[]) => runBuyerMessage({ kind: "buyer", userId, roundIds }, deps());

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
      idea_list_lookups_max: 10,
      zinc_requests_per_second: 10,
      idea_busy_retry_seconds: 300,
      idea_busy_retries_max: 3,
    })) store.settings.set(k, v);
    store.people.set("P", { name: "Zelda", hasAddress: true });
    store.people.set("P2", { name: "Yara", hasAddress: true });
    store.occasionKinds.set("O", "birthday");
    // The money path's SQL (reconcile_round) isn't in the fake: the round keeps its status.
    vi.spyOn(store, "reconcile").mockImplementation(async (...args: unknown[]) => store.round(String(args[0])).status);
    sendJobs = vi.fn<SendJobs>(async (jobs) => ({ sent: jobs.length, failed: 0 }));
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
    expect(await runRound("r1")).toBe("off");
    expect(await runBuyer("U1", ["h1"])).toBe("off");
    expect(claim).not.toHaveBeenCalled();
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("throws when the fan-out switch can't be read, so the queue redelivers, and claims nothing", async () => {
    addRound("h1");
    const claim = vi.spyOn(store, "claim");
    store.settings.delete("round_fanout_enabled");
    await expect(runBuyer("U1", ["h1"])).rejects.toThrow();
    await expect(runRound("h1")).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("throws when a setting read fails before any claim, so the queue redelivers and no lease is held", async () => {
    addRound("h1");
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    const claim = vi.spyOn(store, "claim");
    const schedule = vi.spyOn(store, "scheduleSettings").mockRejectedValue(new Error("db down"));
    await expect(runRound("r1")).rejects.toThrow("db down");
    await expect(runBuyer("U1", ["h1"])).rejects.toThrow("db down");
    schedule.mockRestore();
    // The engine switch and the placing deadline, read before the buyer's claims too.
    store.settings.delete("zinc_place_budget_ms");
    await expect(runBuyer("U1", ["h1"])).rejects.toThrow();
    store.settings.set("zinc_place_budget_ms", 45_000);
    store.settings.delete("round_engine_enabled");
    await expect(runRound("r1")).rejects.toThrow();
    await expect(runBuyer("U1", ["h1"])).rejects.toThrow();
    expect(claim).not.toHaveBeenCalled();
    expect(store.round("r1").lockedUntil).toBeNull();
    expect(store.round("h1").lockedUntil).toBeNull();
    expect(placeRound).not.toHaveBeenCalled();
    // No round_job event of its own: handleJob logs the alert as it rethrows.
    expect(jobEvents()).toEqual([]);
  });

  it("asks a list owner to check their address in the same job when placing was rejected, for its own rounds only", async () => {
    addRound("h1");
    addRound("h2");
    vi.spyOn(store, "roundsWithRejectedAddresses").mockResolvedValue(["h1", "someone-elses"]);
    const asked = vi.spyOn(store, "sharedAddressOwnerToTell");
    await runBuyer("U1", ["h1", "h2"]);
    expect(asked.mock.calls.map((c) => c[0])).toEqual(["h1"]);
  });

  it("throws when a buyer's first claim itself fails, so the queue redelivers a deadline-day hold", async () => {
    addRound("h1");
    addRound("h2");
    vi.spyOn(store, "claim").mockRejectedValue(new Error("connection reset"));
    await expect(runBuyer("U1", ["h1", "h2"])).rejects.toThrow(
      "connection reset",
    );
    expect(placeRound).not.toHaveBeenCalled();
    expect(jobEvents()).toEqual([]);
  });

  it("is failed, not thrown, when something fails after a round was claimed (the next tick picks it up)", async () => {
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    vi.spyOn(store, "roundContext").mockRejectedValue(new Error("database down"));
    await expect(runRound("r1")).resolves.toBe("failed");
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "round", result: "failed", round_id: "r1" })]);
  });

  it("with the engine off, a round message is off and a buyer message still places its held round", async () => {
    addRound("h1");
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    store.settings.set("round_engine_enabled", 0);
    expect(await runRound("r1")).toBe("off");
    expect(store.round("r1").attempts).toBe(0);
    expect(await runBuyer("U1", ["h1"])).toBe("advanced");
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
    expect(await runRound("r1")).toBe("busy");
    expect(emails).toEqual([]);
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "round", result: "busy", round_id: "r1", rounds: 0 })]);
  });

  it.each(["ordered", "skipped"] as const)("is busy for a held round %s since the tick, and places nothing (review focus 1)", async (status) => {
    addRound("h1", { status, nextActionAt: null, attentionReason: null });
    expect(await runBuyer("U1", ["h1"])).toBe("busy");
    expect(placeRound).not.toHaveBeenCalled();
  });

  it("gives back a round message's round that became held since the tick, for the buyer message", async () => {
    addRound("h1");
    expect(await runRound("h1")).toBe("busy");
    expect(placeRound).not.toHaveBeenCalled();
    expect(store.writes).toContain("release:h1");
    expect(store.round("h1")).toMatchObject({ lockedUntil: null, status: "needs_attention" });
  });

  it("runs the step of a buyer message's round that left the money path (a reminder due)", async () => {
    addRound("h1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    expect(await runBuyer("U1", ["h1"])).toBe("advanced");
    expect(emails).toHaveLength(1);
    expect([...store.sends.get("h1")!]).toEqual(["reminder_1"]);
  });

  it("gives back a buyer message's round that left the money path when the engine is off", async () => {
    addRound("h1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    store.settings.set("round_engine_enabled", 0);
    expect(await runBuyer("U1", ["h1"])).toBe("busy");
    expect(emails).toEqual([]);
    expect(store.round("h1").lockedUntil).toBeNull();
  });

  it("gives back a buyer message's round whose step is an idea run, for the next round message", async () => {
    addRound("h1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    expect(await runBuyer("U1", ["h1"])).toBe("busy");
    expect(generateIdeas).not.toHaveBeenCalled();
    expect(store.round("h1")).toMatchObject({ status: "scheduled", lockedUntil: null });
  });

  it("sends a due reminder once and finishes the round with its next date", async () => {
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06" });
    expect(await runRound("r1")).toBe("advanced");
    expect(await runRound("r1")).toBe("busy");
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
    expect(await runRound("r1", { clock })).toBe("advanced");
    expect(generateIdeas).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(1_000 + 270_000 - 6_000);
    expect(store.round("r1").status).toBe("awaiting_approval");
    expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
  });

  it("warns of a low wallet balance in a round message's heads-up (AC-13)", async () => {
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    store.settings.set("funding_lookahead_days", 21);
    store.settings.set("zinc_order_fee_cents", 100);
    vi.spyOn(store, "canBuy").mockResolvedValue(true);
    const bodies: string[] = [];
    const { notify } = deps();
    const round: StepDeps & { sendJobs: SendJobs } = {
      store,
      notify: { ...notify, channels: [{ name: "email", send: async (e) => (bodies.push(e.text), { ok: true as const, id: "m" }) }] },
      now: NOW,
      generateIdeas,
      zinc: {
        wallet: async () => ({ balanceCents: 1000, autoTopUp: false }),
        lookahead: async () => ({ cents: 5000, atLeast: false }),
        walletUrl: "https://zinc.test/wallet",
      },
      clock: () => clockMs,
      sendJobs: async () => ({ sent: 0, failed: 0 }),
    };
    expect(await runRoundMessage({ kind: "round", roundId: "r1" }, round)).toBe("advanced");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Your Zinc balance is low. $50 in gifts are due in the next 3 weeks, and you have $10.");
    expect(bodies[0]).toContain("https://zinc.test/wallet");
  });

  it("runs the step as the tick would when the person was deleted since the tick (review focus 2)", async () => {
    addRound("r1", { status: "awaiting_approval", attentionReason: null, headsUpOn: "2027-02-06", personId: "gone" });
    await expect(runRound("r1")).resolves.toBe("failed");
    expect(events()).toContainEqual(expect.objectContaining({ event: "round_failed", round_id: "r1" }));
    expect(jobEvents()).toEqual([expect.objectContaining({ result: "failed", rounds: 0 })]);
  });

  it("gives each buyer's message its own placing budget (AC-7)", async () => {
    addRound("h1", { userId: "A" });
    addRound("h2", { userId: "B", personId: "P2" });
    placeRound.mockImplementation(async () => void (clockMs += 40_000));
    expect(await runBuyer("A", ["h1"])).toBe("advanced");
    expect(await runBuyer("B", ["h2"])).toBe("advanced");
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
    expect(await runBuyer("U1", ["h1", "h2"])).toBe("failed");
    expect(jobEvents()).toEqual([expect.objectContaining({ kind: "buyer", result: "failed", user_id: "U1", rounds: 1 })]);
  });

  it("logs only ids, counts, flags and enums (AC-17, E6)", async () => {
    addRound("h1");
    addRound("h2");
    addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    addRound("r2", { status: "scheduled", attentionReason: null, headsUpOn: null });
    await runRound("r1");
    await runBuyer("U1", ["h1"]);
    // The daily limit.
    generateIdeas.mockResolvedValueOnce({ status: "refused", reason: "daily_limit" });
    await runRound("r2");
    // A failure carries the error's fields, never its message.
    vi.spyOn(store, "roundContext").mockRejectedValue(Object.assign(new Error("Zelda at 1 Main St"), { code: "57P01" }));
    await runBuyer("U1", ["h2"]);
    // Off.
    store.settings.set("round_fanout_enabled", 0);
    await runRound("r1");
    const mine = events().filter((e) => e.event === "round_job" || e.event === "ideas.daily_limit_reached");
    expect(mine.map((e) => e.event)).toContain("ideas.daily_limit_reached");
    expect(mine.filter((e) => e.result === "failed")).toHaveLength(1);
    expect(strayKeys(mine)).toEqual([]);
    expect(JSON.stringify(mine)).not.toMatch(/Zelda|Main St/);
  });

  describe("what the idea pass came to (AC-10)", () => {
    const run = (over: Partial<EngineDeps> = {}) => runRound("r1", over);
    const addIdeaRound = () => addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
    const ends = (outcome: IdeaOutcome) => generateIdeas.mockImplementation(async () => outcome);
    /** The whole round_job event: `ideas` is absent unless given. */
    const logged = (result: JobResult, ideas?: string) => ({
      event: "round_job",
      at: expect.any(String),
      kind: "round",
      result,
      round_id: "r1",
      rounds: result === "advanced" ? 1 : 0,
      ...(ideas === undefined ? {} : { ideas }),
    });
    async function expectJob(result: JobResult, ideas?: string, over?: Partial<EngineDeps>, followUps = 0) {
      expect(await run(over)).toBe(result);
      expect(sendJobs).toHaveBeenCalledTimes(followUps);
      expect(jobEvents()).toEqual([logged(result, ideas)]);
      expect(strayKeys(jobEvents())).toEqual([]);
    }
    const refusing = () => {
      const d = deps();
      return { notify: { ...d.notify, channels: [{ name: "email" as const, send: async () => ({ ok: false as const, error: "Refused" }) }] } };
    };
    /** Ends the round by a date change just before the engine's next call to `method`. */
    function moveBefore(method: "finish" | "release" | "holdsLease") {
      const real = store[method].bind(store) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(store, method).mockImplementationOnce((async (...args: unknown[]) => {
        store.endByMove("r1");
        return real(...args);
      }) as never);
    }

    beforeEach(() => void addIdeaRound());

    it.each<[IdeaOutcome, string, number]>([
      [{ status: "refused", reason: "busy" }, "refused:busy", 1],
      [{ status: "refused", reason: "daily_limit" }, "refused:daily_limit", 0],
      [{ status: "off" }, "off", 0],
      [{ status: "no_credit" }, "no_credit", 0],
    ])("%o waits: released, still due", async (outcome, ideas, followUps) => {
      ends(outcome);
      await expectJob("waiting", ideas, undefined, followUps);
      expect(store.writes).toContain("release:r1");
      expect(store.round("r1")).toMatchObject({ status: "generating", lockedUntil: null });
      expect(await store.dueRounds(NOW)).toHaveLength(1);
    });

    it("not enough time left waits, with no run", async () => {
      store.settings.set("tick_deadline_ms", 100_000);
      await expectJob("waiting", "no_time");
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(store.round("r1")).toMatchObject({ status: "scheduled", lockedUntil: null });
    });

    it("refused done sends the heads-up of the ideas already there", async () => {
      generateIdeas.mockImplementation(async (round) => {
        store.ideas.set(round.id, [{ title: "Mug", totalCents: 4200 }]);
        return { status: "refused", reason: "done" };
      });
      await expectJob("advanced", "refused:done");
      expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
    });

    it.each<[IdeaOutcome, string]>([
      [{ status: "refused", reason: "limit" }, "refused:limit"],
      [{ status: "refused", reason: "not_paid" }, "refused:not_paid"],
      [{ status: "refused", reason: "not_found" }, "refused:not_found"],
      [{ status: "no_facts" }, "no_facts"],
      [{ status: "saved", count: 0 }, "saved"],
      [{ status: "none" }, "none"],
      [{ status: "failed" }, "failed"],
      [{ status: "deadline" }, "deadline"],
      [{ status: "cost_cap" }, "cost_cap"],
    ])("%o moves on", async (outcome, ideas) => {
      ends(outcome);
      await expectJob("advanced", ideas);
      expect(store.writes.filter((w) => w === "finish:r1:generating")).toHaveLength(2);
      expect(store.writes).not.toContain("release:r1");
      expect(store.round("r1").lockedUntil).toBeNull();
    });

    it("saved ideas move on with the heads-up", async () => {
      await expectJob("advanced", "saved");
      expect(store.round("r1").status).toBe("awaiting_approval");
    });

    it("ideas brought back keep the run's outcome", async () => {
      ends({ status: "none" });
      vi.spyOn(store, "restoreRejected").mockImplementation((async () => {
        store.ideas.set("r1", [{ title: "Mug", totalCents: 4200 }]);
        return { count: 1, outcome: null };
      }) as never);
      await expectJob("advanced", "none");
      expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
    });

    it("the too-late email keeps the run's outcome", async () => {
      ends({ status: "none" });
      const now = new Date("2027-03-10T12:00:00Z");
      await expectJob("advanced", "none", { now, notify: { ...deps().notify, now } });
      expect([...store.sends.get("r1")!]).toEqual(["no_ideas_late"]);
    });

    it("a refused heads-up after the run fails, and keeps what the run came to", async () => {
      await expectJob("failed", "saved", refusing());
      expect(store.round("r1").lockedUntil).not.toBeNull();
    });

    it("another run took the round in between: busy", async () => {
      const real = store.claim.bind(store);
      vi.spyOn(store, "claim").mockImplementationOnce(real).mockResolvedValueOnce(null);
      await expectJob("busy");
      expect(generateIdeas).not.toHaveBeenCalled();
    });

    it("another run already sent the too-late email: released, busy", async () => {
      vi.spyOn(store, "sentSteps").mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set(["no_ideas_late"]));
      await expectJob("busy");
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(store.writes).toContain("release:r1");
    });

    it.each(["not_paid", "busy", "closed"] as const)("a date change during a run refused %s: busy, with the refusal", async (reason) => {
      generateIdeas.mockImplementation(async (round) => {
        store.endByMove(round.id);
        return { status: "refused", reason };
      });
      await expectJob("busy", `refused:${reason}`);
      expect(events().filter((e) => e.event === "round_ended_by_move")).toHaveLength(1);
    });

    it("a date change after the run, before its heads-up: busy, with the outcome", async () => {
      moveBefore("holdsLease");
      await expectJob("busy", "saved");
      expect(emails).toEqual([]);
    });

    it("a date change before the run: busy, no outcome", async () => {
      moveBefore("finish");
      await expectJob("busy");
      expect(generateIdeas).not.toHaveBeenCalled();
    });

    it("a date change seen releasing a round with no time left: busy, no outcome", async () => {
      store.settings.set("tick_deadline_ms", 100_000);
      moveBefore("release");
      await expectJob("busy");
    });

    it("refused closed with no date change fails: the lease was lost", async () => {
      ends({ status: "refused", reason: "closed" });
      await expectJob("failed", "refused:closed");
    });

    it("a run that throws fails, with no outcome and the lease kept", async () => {
      generateIdeas.mockRejectedValue(new Error("database down"));
      await expectJob("failed");
      expect(store.round("r1").lockedUntil).not.toBeNull();
    });

    it.each(["tick_deadline_ms", "idea_ai_timeout_ms"])("%s unreadable fails, released", async (key) => {
      store.settings.delete(key);
      await expectJob("failed");
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(store.round("r1")).toMatchObject({ status: "scheduled", lockedUntil: null });
    });

    it("AC-6b: a release that fails still waits, and says it failed", async () => {
      ends({ status: "refused", reason: "busy" });
      vi.spyOn(store, "release").mockRejectedValue(new Error("database down"));
      await expectJob("waiting", "refused:busy");
      expect(events().filter((e) => e.event === "round_release_failed")).toHaveLength(1);
    });

    it("AC-6b: a date change seen by the release is busy, not waiting", async () => {
      ends({ status: "refused", reason: "busy" });
      moveBefore("release");
      await expectJob("busy", "refused:busy");
      expect(events().some((e) => e.event === "round_release_failed")).toBe(false);
    });

    describe("before the pass, as it always was", () => {
      it("a round that already has ideas sends its heads-up", async () => {
        store.ideas.set("r1", [{ title: "Mug", totalCents: 4200 }]);
        await expectJob("advanced");
        expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
        expect(generateIdeas).not.toHaveBeenCalled();
      });

      it("a date change in that step stays advanced", async () => {
        store.ideas.set("r1", [{ title: "Mug", totalCents: 4200 }]);
        moveBefore("holdsLease");
        await expectJob("advanced");
        expect(events().some((e) => e.event === "round_ended_by_move")).toBe(true);
        expect(emails).toEqual([]);
      });

      it("a round without paid features waits for its deadline", async () => {
        store.ideaState.set("r1", { paid: false });
        await expectJob("advanced");
        expect(generateIdeas).not.toHaveBeenCalled();
      });
    });
  });

  describe("a round refused busy gets one delayed follow-up", () => {
    const notSent = () => events().filter((e) => e.event === "round_retry_not_sent");
    const followUp: RoundMessage = { kind: "round", roundId: "r1", retry: 1 };
    const waited = () => expect(jobEvents()).toEqual([expect.objectContaining({ result: "waiting", ideas: "refused:busy", round_id: "r1" })]);

    beforeEach(() => {
      addRound("r1", { status: "scheduled", attentionReason: null, headsUpOn: null });
      generateIdeas.mockImplementation(async () => ({ status: "refused", reason: "busy" }));
    });
    afterEach(() => {
      const ours = ["round_job", "round_retry_not_sent", "round_release_failed"];
      const mine = events().filter((e) => ours.includes(e.event));
      expect(mine).not.toEqual([]);
      expect(strayKeys(mine)).toEqual([]);
    });

    it("AC-4: sent once the round is unlocked, with the delay and the next count", async () => {
      let lease: Date | null | undefined;
      sendJobs.mockImplementation(async (jobs) => ((lease = store.round("r1").lockedUntil), { sent: jobs.length, failed: 0 }));
      expect(await runRound("r1")).toBe("waiting");
      expect(sendJobs.mock.calls).toEqual([
        [[{ message: { kind: "round", roundId: "r1", retry: 1 }, idempotencyKey: "round:r1:2027-02-11:retry:1", delaySeconds: 300 }]],
      ]);
      expect(lease).toBeNull();
      waited();
      expect(events().filter((e) => e.alert)).toEqual([]);
      expect(notSent()).toEqual([]);
    });

    it("AC-4: a follow-up refused again is put off again, with its test clock", async () => {
      const now = NOW.toISOString();
      expect(await runMessage({ ...followUp, now })).toBe("waiting");
      expect(sendJobs.mock.calls[0]![0]).toEqual([
        { message: { kind: "round", roundId: "r1", retry: 2, now }, idempotencyKey: "round:r1:2027-02-11:retry:2", delaySeconds: 300 },
      ]);
    });

    it.each([
      ["at the limit", 3, {}],
      ["with the delay 0", undefined, { idea_busy_retry_seconds: 0 }],
      ["with the limit 0", undefined, { idea_busy_retries_max: 0 }],
    ])("AC-5: %s nothing is sent or logged, and the round stays due", async (_n, retry, settings) => {
      for (const [k, v] of Object.entries(settings)) store.settings.set(k, v);
      expect(await runMessage({ kind: "round", roundId: "r1", ...(retry === undefined ? {} : { retry }) })).toBe("waiting");
      expect(sendJobs).not.toHaveBeenCalled();
      expect(notSent()).toEqual([]);
      waited();
      expect(await store.dueRounds(NOW)).toHaveLength(1);
    });

    it.each(["idea_busy_retry_seconds", "idea_busy_retries_max"])("AC-6: %s missing sends nothing, says so, and still waits", async (key) => {
      store.settings.delete(key);
      expect(await runRound("r1")).toBe("waiting");
      expect(sendJobs).not.toHaveBeenCalled();
      expect(notSent()).toEqual([
        { event: "round_retry_not_sent", at: expect.any(String), round_id: "r1", user_id: "U1", reason: "settings" },
      ]);
      waited();
    });

    it.each<[string, SendJobs]>([
      ["returns failed", async () => ({ sent: 0, failed: 1 })],
      [
        "throws",
        async () => {
          throw new Error("Zelda at 1 Main St");
        },
      ],
    ])("AC-6: a send that %s says so, is not tried again, and still waits", async (_n, send) => {
      sendJobs.mockImplementation(send);
      expect(await runRound("r1")).toBe("waiting");
      expect(sendJobs).toHaveBeenCalledTimes(1);
      expect(notSent()).toEqual([
        { event: "round_retry_not_sent", at: expect.any(String), round_id: "r1", user_id: "U1", reason: "send_failed" },
      ]);
      expect(events().filter((e) => e.alert)).toEqual([]);
      waited();
    });

    it.each<[string, JobResult, () => void]>([
      ["fan-out is off", "off", () => store.settings.set("round_fanout_enabled", 0)],
      ["the engine is off", "off", () => store.settings.set("round_engine_enabled", 0)],
      ["the round was skipped", "busy", () => Object.assign(store.round("r1"), { status: "skipped", nextActionAt: null })],
      ["the round finished", "busy", () => Object.assign(store.round("r1"), { status: "ordered", nextActionAt: null })],
      ["the round is leased", "busy", () => Object.assign(store.round("r1"), { lockedUntil: new Date(NOW.getTime() + 60_000) })],
    ])("AC-8: the follow-up does nothing when %s", async (_n, result, before) => {
      before();
      expect(await runMessage(followUp)).toBe(result);
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(emails).toEqual([]);
      expect(sendJobs).not.toHaveBeenCalled();
    });

    it("AC-9 (a): with the idea engine off, the follow-up waits and sends nothing", async () => {
      store.ideaState.set("r1", { ideaEngineOn: false });
      generateIdeas.mockImplementation(async () => ({ status: "off" }));
      expect(await runMessage(followUp)).toBe("waiting");
      expect(jobEvents()).toEqual([expect.objectContaining({ result: "waiting", ideas: "off" })]);
      expect(sendJobs).not.toHaveBeenCalled();
    });

    it("AC-9 (b): with paid features lost, the round waits for its deadline, with no run", async () => {
      store.ideaState.set("r1", { paid: false });
      expect(await runMessage(followUp)).toBe("advanced");
      expect(jobEvents()[0]).not.toHaveProperty("ideas");
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(sendJobs).not.toHaveBeenCalled();
      expect(store.round("r1").nextActionAt).toEqual(new Date("2027-03-11T00:00:00Z"));
    });

    it("AC-9 (d): a round that got ideas sends its heads-up, with no run", async () => {
      store.ideas.set("r1", [{ title: "Mug", totalCents: 4200 }]);
      expect(await runMessage(followUp)).toBe("advanced");
      expect(jobEvents()[0]).not.toHaveProperty("ideas");
      expect([...store.sends.get("r1")!]).toEqual(["heads_up"]);
      expect(generateIdeas).not.toHaveBeenCalled();
      expect(sendJobs).not.toHaveBeenCalled();
    });
  });
});
