// @vitest-environment node
import type { ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { planJobs, type QueuedJob, type SendJobs } from "../rounds/fanout";
import { runTick, type EngineDeps } from "../rounds/engine";
import type { DueRound } from "../rounds/store";
import { FakeRoundStore } from "./fake-round-store";
import { FakeStore } from "./fake-store";

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

  it("runs today's path when the switch is 0 or there is no sendJobs", async () => {
    store.settings.set("round_fanout_enabled", 0);
    await runTick(deps());
    store.settings.set("round_fanout_enabled", 1);
    await runTick(deps({ sendJobs: undefined }));
    expect(sendJobs).not.toHaveBeenCalled();
    expect(events().filter((e) => e.event === "round_fanout")).toHaveLength(0);
  });
});
