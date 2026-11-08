// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { addDays, compareDates, type CalendarDate, type Database, type ScheduleSettings } from "@gifts-af/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { Channel } from "../notify/channels";
import { confirmActionLink } from "../notify/links";
import { createSupabaseNotifyStore } from "../notify/store";
import { approveAndBuy } from "../purchase/approve";
import { placeRound, sweepStalePlacing } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import {
  advanceRound,
  resumeRoundsForPerson,
  retryOrderedEmails,
  runTick,
  tellOrdered,
  tellOwnerOfRejection,
  tellOwnersOfRejections,
  type EngineDeps,
  type EngineZinc,
} from "../rounds/engine";
import { createSupabaseRoundStore } from "../rounds/store";
import { FakeRoundStore } from "./fake-round-store";
import { FakeStore } from "./fake-store";
import { FakeZinc } from "./fake-zinc";

vi.mock("server-only", () => ({}));

// Birthday 2027-03-20 with the default settings: deadline 03-11, start 02-11,
// heads-up 02-11, reminder 1 02-16, reminder 2 03-04, final notice 03-09.
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
const USER = "user-1";
const PERSON = "person-1";
const OCCASION = "occasion-1";
const NAME = "Zelda Quartermain";
const EMAIL = "buyer@example.com";
const BASE = "https://giftsaf.test";

const at = (day: CalendarDate, time = "12:00:00") => new Date(`${day}T${time}Z`);

type Sent = Parameters<Channel["send"]>[0];

function harness(opts: { hasAddress?: boolean; candidateFrom?: CalendarDate; zinc?: EngineZinc } = {}) {
  const store = new FakeRoundStore();
  store.settings.set("round_engine_enabled", 1);
  store.settings.set("round_lock_minutes", 10);
  store.settings.set("round_max_attempts", 3);
  store.settings.set("zinc_place_budget_ms", 45_000);
  store.schedule = SCHEDULE;
  store.people.set(PERSON, { name: NAME, hasAddress: opts.hasAddress ?? true });
  store.occasionKinds.set(OCCASION, "birthday");
  const candidate = {
    userId: USER,
    personId: PERSON,
    occasionId: OCCASION,
    rule: { kind: "birthday" as const, month: 3, day: 20 },
    budgetCents: 5000,
  };

  const notifyStore = new FakeStore();
  notifyStore.recipients.set(USER, { email: EMAIL, timezone: null });

  /** The test's day, and the days the channel refuses every send. */
  const clock = { today: "2027-01-01" as CalendarDate, refuseOn: new Set<CalendarDate>() };
  const emails: (Sent & { day: CalendarDate })[] = [];
  const channel: Channel = {
    name: "email",
    send: async (email: Sent) => {
      if (clock.refuseOn.has(clock.today)) return { ok: false as const, error: "Refused" };
      emails.push({ ...email, day: clock.today });
      return { ok: true as const, id: `msg-${emails.length}` };
    },
  };
  const generateIdeas = vi.fn(async (roundId: string) => {
    if (!store.ideas.has(roundId)) {
      store.ideas.set(roundId, [
        { title: "Stoneware mug set", totalCents: 4200 },
        { title: "Herb planter", totalCents: 3850 },
      ]);
    }
  });
  const deps = (now: Date): EngineDeps => ({
    store,
    notify: { store: notifyStore, channels: [channel], baseUrl: BASE, now },
    now,
    generateIdeas,
    zinc: opts.zinc ?? null,
  });
  const tick = (day: CalendarDate, time?: string) => {
    clock.today = day;
    if (!opts.candidateFrom || compareDates(day, opts.candidateFrom) >= 0) store.candidateRows = [candidate];
    return runTick(deps(at(day, time)));
  };

  const h = Object.assign(clock, {
    store,
    notifyStore,
    emails,
    generateIdeas,
    deps,
    tick,
    async runDays(from: CalendarDate, to: CalendarDate) {
      for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) await tick(d);
    },
    /** Sent notifications as "kind@day". */
    sent() {
      return notifyStore.notifications
        .filter((n) => n.sentAt)
        .map((n) => `${n.kind}@${n.sentAt!.toISOString().slice(0, 10)}`);
    },
  });
  return h;
}

let log: MockInstance<typeof console.log>;
const events = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
const named = (name: string) => events().filter((e) => e.event === name);

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

describe("runTick", () => {
  it("creates and moves on no ordinary round when the engine is off (AC-2)", async () => {
    const h = harness();
    h.store.settings.set("round_engine_enabled", 0);

    const summary = await h.tick("2027-02-11");

    expect(summary).toEqual({ enabled: false, created: 0, advanced: 0, failed: 0 });
    expect(h.store.writes).toEqual([]);
    expect(h.notifyStore.notifications).toEqual([]);
    expect(events()).toEqual([expect.objectContaining({ event: "round_tick", enabled: false })]);
  });

  // ALL-112: closed and cancelled rounds are only reached this way, and it runs with the engine off.
  it.each([1, 0])("deals with rejected shared addresses on every tick (round_engine_enabled %i)", async (on) => {
    const h = harness();
    h.store.settings.set("round_engine_enabled", on);
    vi.spyOn(h.store, "roundsWithRejectedAddresses").mockResolvedValue(["round-x"]);
    const clear = vi.spyOn(h.store, "clearRejectedAddresses");
    await runTick(h.deps(at("2027-02-11")));
    expect(clear).toHaveBeenCalledWith("round-x");
  });

  // S6 (owner): the money path never waits on round_engine_enabled.
  it("still sweeps, retries ordered emails and claims money-path rounds when the engine is off", async () => {
    const sweep = vi.fn(async () => 0);
    const zinc: EngineZinc = {
      placeRound: vi.fn(async () => {}),
      sweep,
      wallet: async () => ({ balanceCents: null, autoTopUp: null }),
      lookahead: async () => ({ cents: 0, atLeast: false }),
      walletUrl: "https://zinc.test/wallet",
    };
    const h = harness({ zinc });
    await h.tick("2027-02-11"); // an ordinary round, awaiting approval
    sweep.mockClear();
    h.store.settings.set("round_engine_enabled", 0);
    const missing = vi.spyOn(h.store, "roundsMissingOrderedEmail");
    const money = vi.spyOn(h.store, "claimDueMoney");
    const due = vi.spyOn(h.store, "claimDue");
    const writes = h.store.writes.length;

    await h.tick("2027-02-16"); // reminder_1 would be due

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(money).toHaveBeenCalledTimes(1);
    expect(due).not.toHaveBeenCalled();
    expect(h.store.writes).toHaveLength(writes);
    expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
  });

  it("creates a round on its start day, once, even across two ticks (AC-3, AC-4)", async () => {
    const h = harness();
    await h.tick("2027-02-10");
    expect(h.store.rounds).toHaveLength(0);

    const first = await h.tick("2027-02-11");
    const second = await h.tick("2027-02-11", "13:00:00");

    expect(first).toMatchObject({ enabled: true, created: 1, advanced: 1, failed: 0 });
    expect(second).toMatchObject({ created: 0 });
    expect(h.store.rounds).toHaveLength(1);
    expect(h.store.rounds[0]).toMatchObject({
      userId: USER,
      personId: PERSON,
      occasionId: OCCASION,
      occasionYear: 2027,
      occasionDate: "2027-03-20",
      shipByDeadline: "2027-03-11",
      budgetCents: 5000,
      late: false,
    });
  });

  it("runs a round from scheduled to skipped, each email once on its day (AC-5)", async () => {
    const h = harness();
    await h.runDays("2027-02-01", "2027-03-20");

    expect(h.sent()).toEqual([
      "heads_up@2027-02-11",
      "reminder@2027-02-16",
      "reminder@2027-03-04",
      "final_notice@2027-03-09",
      "skipped@2027-03-11",
    ]);
    const round = h.store.rounds[0];
    expect(round.history).toEqual(["scheduled", "generating", "awaiting_approval", "skipped"]);
    expect(round.status).toBe("skipped");
    expect(round.nextActionAt).toBeNull();
    expect([...h.store.sends.get(round.id)!]).toEqual([
      "heads_up",
      "reminder_1",
      "reminder_2",
      "final_notice",
      "skipped",
    ]);
    expect(h.store.rounds).toHaveLength(1);
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
  });

  it("fills the emails with the person, dates and ideas, and one-time links to their page", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-11");

    const headsUp = h.emails[0];
    expect(headsUp.to).toBe(EMAIL);
    expect(headsUp.subject).toContain(`${NAME}'s birthday`);
    expect(headsUp.text).toContain("Sat, Mar 20");
    expect(headsUp.text).toContain("Stoneware mug set · $42");
    expect(headsUp.text).toContain("Herb planter · $38.50");
    const final = h.emails.find((e) => e.subject.startsWith("Last chance"))!;
    expect(final.text).toContain("by Wed, Mar 10");

    const links = h.notifyStore.links;
    expect(links).toHaveLength(5);
    for (const l of links) {
      expect(l).toMatchObject({ userId: USER, roundId: "round-1", action: "open_person" });
      expect(l.expiresAt).toEqual(new Date("2027-03-11T23:59:00Z"));
    }
  });

  it("links open questions in the heads-up and reminders only (ALL-26 AC-10)", async () => {
    const h = harness();
    h.store.people.set(PERSON, { name: NAME, hasAddress: true, openQuestions: 2 });
    await h.runDays("2027-02-01", "2027-03-12");

    const asked = h.emails.filter((e) => e.text.includes(`Answer 2 quick questions about ${NAME}`));
    expect(asked.map((e) => h.sent()[h.emails.indexOf(e)].split("@")[0])).toEqual(["heads_up", "reminder", "reminder"]);
    const questionLinks = h.notifyStore.links.filter((l) => l.action === "answer_questions");
    expect(questionLinks).toHaveLength(3);
    for (const l of questionLinks) expect(l).toMatchObject({ userId: USER, roundId: "round-1" });
  });

  it("adds no link when no questions are open (ALL-26 AC-10)", async () => {
    const h = harness();
    await h.runDays("2027-02-01", "2027-03-12");
    expect(h.emails.some((e) => e.text.includes("quick question"))).toBe(false);
    expect(h.notifyStore.links.some((l) => l.action === "answer_questions")).toBe(false);
  });

  it("squeezes a late round's schedule and says time is short (AC-6)", async () => {
    const h = harness({ candidateFrom: "2027-03-05" });
    await h.runDays("2027-03-01", "2027-03-15");

    expect(h.sent()).toEqual(["heads_up@2027-03-05", "final_notice@2027-03-09", "skipped@2027-03-11"]);
    expect(h.store.rounds[0].late).toBe(true);
    expect(h.emails[0].text).toContain("is close, so we've kept only gifts that can still arrive in time");
  });

  it("asks for a missing address on the reminder schedule, then skips (AC-8)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-01", "2027-03-20");

    expect(h.sent()).toEqual([
      "needs_address@2027-02-11",
      "needs_address@2027-02-16",
      "needs_address@2027-03-04",
      "needs_address@2027-03-09",
      "skipped@2027-03-11",
    ]);
    const round = h.store.rounds[0];
    expect(round.history).toEqual(["scheduled", "needs_address", "skipped"]);
    expect([...h.store.sends.get(round.id)!]).toEqual([
      "address_request",
      "address_reminder_1",
      "address_reminder_2",
      "address_final_notice",
      "skipped",
    ]);
    expect(h.generateIdeas).not.toHaveBeenCalled();
    expect(h.emails[0].text).not.toContain("A reminder:");
    expect(h.emails[1].text).toContain("A reminder:");
    // The address emails' button opens the address form; the skipped email's opens the page (ALL-81 AC-8, AC-9).
    expect(h.notifyStore.links.map((l) => l.action)).toEqual([
      "add_address",
      "add_address",
      "add_address",
      "add_address",
      "open_person",
    ]);
  });
});

describe("resumeRoundsForPerson", () => {
  it("a share arriving after the last tick before the deadline still skips, with the skip email (ALL-63 AC-21)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-11", "2027-03-10");
    h.store.people.get(PERSON)!.hasAddress = true;
    await h.tick("2027-03-11");

    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent()).not.toContain("heads_up@2027-03-11");
    expect(h.sent()).toContain("skipped@2027-03-11");
  });

  it("a waiting round notices an address at the next daily tick, with no resume and no extra email (ALL-63 AC-19)", async () => {
    const h = harness({ hasAddress: false });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0].status).toBe("needs_address");
    // Days before its next reminder, nothing goes out and the round is still looked at.
    await h.tick("2027-02-12");
    await h.tick("2027-02-13");
    expect(h.sent()).toEqual(["needs_address@2027-02-11"]);

    h.store.people.get(PERSON)!.hasAddress = true;
    await h.tick("2027-02-14");

    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.sent()).toEqual(["needs_address@2027-02-11", "heads_up@2027-02-14"]);
  });

  it("sends the heads-up as soon as the address arrives and restarts the reminders (AC-9)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-11", "2027-02-19");
    h.store.people.get(PERSON)!.hasAddress = true;

    h.today = "2027-02-20";
    await resumeRoundsForPerson(PERSON, h.deps(at("2027-02-20", "09:30:00")));
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.store.rounds[0].headsUpOn).toBe("2027-02-20");

    await h.runDays("2027-02-20", "2027-03-20");
    expect(h.sent()).toEqual([
      "needs_address@2027-02-11",
      "needs_address@2027-02-16",
      "heads_up@2027-02-20",
      "reminder@2027-02-25",
      "reminder@2027-03-04",
      "final_notice@2027-03-09",
      "skipped@2027-03-11",
    ]);
    expect(h.store.rounds[0].history).toEqual([
      "scheduled",
      "needs_address",
      "generating",
      "awaiting_approval",
      "skipped",
    ]);
  });

  it("does nothing when the engine is off", async () => {
    const h = harness({ hasAddress: false });
    await h.tick("2027-02-11");
    h.store.settings.set("round_engine_enabled", 0);
    h.store.people.get(PERSON)!.hasAddress = true;
    const writes = h.store.writes.length;

    await resumeRoundsForPerson(PERSON, h.deps(at("2027-02-12")));

    expect(h.store.writes).toHaveLength(writes);
    expect(h.store.rounds[0].status).toBe("needs_address");
  });
});

describe("advanceRound", () => {
  it("leaves a round the tick holds alone (AC-10)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    const now = at("2027-02-16");
    const held = await h.store.claim("round-1", now); // the tick has it
    expect(held).not.toBeNull();
    const sentBefore = h.sent().length;

    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(new Date(now.getTime() + 1000)))).toBe("busy");
    expect(h.sent()).toHaveLength(sentBefore);
    expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
  });

  it("does nothing when the engine is off", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.store.settings.set("round_engine_enabled", 0);
    const writes = h.store.writes.length;
    const sent = h.emails.length;

    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(at("2027-02-16")))).toBe("off");
    expect(h.store.writes).toHaveLength(writes);
    expect(h.emails).toHaveLength(sent);
  });

  it("advances a due round right away", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(at("2027-02-16", "08:00:00")))).toBe("advanced");
    expect(h.sent()).toContain("reminder@2027-02-16");
  });
});

describe("failures", () => {
  it("never sends an email twice when a step dies after recording it (AC-11)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    // The process "dies" after the email went out: notify throws, not a clean refusal.
    const finish = h.notifyStore.finishNotification.bind(h.notifyStore);
    h.notifyStore.finishNotification = async () => {
      h.notifyStore.finishNotification = finish;
      throw new Error("connection lost");
    };

    expect(await h.tick("2027-02-16")).toMatchObject({ advanced: 0, failed: 1 });
    expect(await h.tick("2027-02-16", "12:05:00")).toMatchObject({ advanced: 0, failed: 0 }); // still leased
    expect(await h.tick("2027-02-16", "12:11:00")).toMatchObject({ advanced: 1, failed: 0 }); // lease expired

    expect(h.emails.filter((e) => e.subject.startsWith("Reminder"))).toHaveLength(1);
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.store.rounds[0].nextActionAt).toEqual(at("2027-03-04", "00:00:00"));
  });

  // The heads-up and the skip are where the send record is the only guard:
  // nextAction keeps saying "generate" or "skip" until the status moves on.
  it.each([
    { step: "heads_up", day: "2027-02-11", subject: "Zelda Quartermain's birthday: 2 gifts", status: "awaiting_approval" },
    { step: "skipped", day: "2027-03-11", subject: "No gift for", status: "skipped" },
  ])("never resends $step after a crash mid-step (AC-11)", async ({ day, subject, status }) => {
    const h = harness();
    await h.runDays("2027-02-01", addDays(day, -1));
    const finish = h.notifyStore.finishNotification.bind(h.notifyStore);
    h.notifyStore.finishNotification = async () => {
      h.notifyStore.finishNotification = finish;
      throw new Error("connection lost");
    };

    expect(await h.tick(day)).toMatchObject({ failed: 1 });
    expect(await h.tick(day, "12:11:00")).toMatchObject({ advanced: 1, failed: 0 });

    expect(h.emails.filter((e) => e.subject.startsWith(subject))).toHaveLength(1);
    expect(h.store.rounds[0].status).toBe(status);
  });

  it("retries a clean refusal daily, logs round_stuck after 3 failures, and resets on success (AC-12)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.refuseOn = new Set(["2027-02-16", "2027-02-17", "2027-02-18", "2027-02-20"]);

    for (const day of ["2027-02-16", "2027-02-17", "2027-02-18"]) {
      expect(await h.tick(day)).toMatchObject({ failed: 1 });
      expect(h.store.rounds[0].status).toBe("awaiting_approval");
      expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
    }
    expect(named("round_stuck")).toEqual([]);
    expect(h.store.rounds[0].attempts).toBe(3);

    // The 4th tick: logged as stuck, and the step still runs (and works).
    expect(await h.tick("2027-02-19")).toMatchObject({ advanced: 1, failed: 0 });
    expect(named("round_stuck")).toEqual([
      expect.objectContaining({ round_id: "round-1", user_id: USER, status: "awaiting_approval", attempts: 4 }),
    ]);
    expect(h.sent()).toContain("reminder@2027-02-19");
    expect(h.store.rounds[0].attempts).toBe(0);

    // The count starts over: nothing more is due until reminder 2.
    await h.runDays("2027-02-20", "2027-03-03");
    expect(named("round_stuck")).toHaveLength(1);
    // The buyer only ever got the reminder, never an email about our failure.
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-19"]);
  });

  it("still skips a stuck round at its deadline", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-03");
    h.refuseOn = new Set(["2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07", "2027-03-08", "2027-03-09", "2027-03-10"]);
    await h.runDays("2027-03-04", "2027-03-11");
    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent().at(-1)).toBe("skipped@2027-03-11");
  });

  it("still skips at the deadline when the skipped email is refused, and says so (ruling 12)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-10");
    h.refuseOn = new Set(["2027-03-11"]);

    expect(await h.tick("2027-03-11")).toMatchObject({ advanced: 1, failed: 0 });

    const round = h.store.rounds[0];
    expect(round.status).toBe("skipped");
    expect(round.nextActionAt).toBeNull();
    // Nothing went out, so nothing is recorded as sent.
    expect(h.store.sends.get(round.id)!.has("skipped")).toBe(false);
    expect(named("round_skip_email_failed")).toEqual([
      expect.objectContaining({ round_id: round.id, user_id: USER }),
    ]);
    await h.runDays("2027-03-12", "2027-03-20");
    expect(h.sent().filter((s) => s.startsWith("skipped"))).toEqual([]);
  });

  it("skips silently a round whose buyer was never asked (ruling 13)", async () => {
    const h = harness();
    h.generateIdeas.mockImplementation(async () => {
      throw new Error("ideas failed");
    });
    await h.runDays("2027-02-11", "2027-03-20");

    const round = h.store.rounds[0];
    expect(round.status).toBe("skipped");
    expect(round.history).toEqual(["scheduled", "generating", "skipped"]);
    expect(round.nextActionAt).toBeNull();
    expect(h.sent()).toEqual([]);
    expect(named("round_skipped_silently")).toEqual([
      expect.objectContaining({ round_id: round.id, user_id: USER, status: "generating" }),
    ]);
  });

  it("keeps the other rounds going when one fails", async () => {
    const h = harness();
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    h.generateIdeas.mockImplementation(async (roundId: string) => {
      if (roundId === "round-1") throw new Error("ideas failed");
      h.store.ideas.set(roundId, [{ title: "Book", totalCents: 2000 }]);
    });
    // Two people with a birthday the same day.
    const rule = { kind: "birthday" as const, month: 3, day: 20 };
    h.today = "2027-02-11";
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 },
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule, budgetCents: null },
    ];
    const summary = await runTick(h.deps(at("2027-02-11")));

    expect(summary).toEqual({ enabled: true, created: 2, advanced: 1, failed: 1 });
    expect(h.store.round("round-2").status).toBe("awaiting_approval");
  });

  it("keeps creating and advancing rounds when one occasion fails to create", async () => {
    const h = harness();
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    const insert = h.store.insertRound.bind(h.store);
    h.store.insertRound = async (r) => {
      if (r.personId === PERSON) throw new Error("insert failed");
      return insert(r);
    };
    const rule = { kind: "birthday" as const, month: 3, day: 20 };
    h.today = "2027-02-11";
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 },
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule, budgetCents: null },
    ];

    const summary = await runTick(h.deps(at("2027-02-11")));

    // `failed` counts the occasion that couldn't be created as well as rounds that failed.
    expect(summary).toEqual({ enabled: true, created: 1, advanced: 1, failed: 1 });
    expect(h.store.rounds[0]).toMatchObject({ personId: "person-2", status: "awaiting_approval" });
    expect(named("round_create_failed")).toEqual([
      expect.objectContaining({ occasion_id: OCCASION, person_id: PERSON, user_id: USER }),
    ]);
    expect(named("round_tick")).toHaveLength(1);
  });
});

describe("events (AC-14)", () => {
  it("log ids, statuses and counts only", async () => {
    const h = harness({ hasAddress: false });
    h.refuseOn = new Set(["2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19"]);
    await h.runDays("2027-02-11", "2027-02-19");
    h.store.people.get(PERSON)!.hasAddress = true;
    h.today = "2027-02-20";
    await resumeRoundsForPerson(PERSON, h.deps(at("2027-02-20", "09:00:00")));
    await h.runDays("2027-02-20", "2027-03-12");

    const allowed = new Set([
      "event",
      "at",
      "enabled",
      "created",
      "advanced",
      "failed",
      "round_id",
      "user_id",
      "status",
      "next_status",
      "step",
      "attempts",
      "error",
      // errorFields (N3): the error's name, and its kind and code when they are plain tokens.
      "name",
      "kind",
      "code",
    ]);
    expect(named("round_tick").length).toBeGreaterThan(0);
    expect(named("round_stuck").length).toBeGreaterThan(0);
    for (const e of events()) {
      for (const key of Object.keys(e)) expect(allowed).toContain(key);
      const text = JSON.stringify(e);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain("Stoneware");
    }
  });
});

// ─── ALL-32: the heads-up's funding warning (AC-11) ─────────────────────────

describe("heads-up funding warning (AC-11)", () => {
  function zincFake(over: Partial<EngineZinc> = {}) {
    return {
      placeRound: vi.fn(async () => {}),
      sweep: vi.fn(async () => 0),
      wallet: vi.fn(async () => ({ balanceCents: 4000, autoTopUp: false as boolean | null })),
      lookahead: vi.fn(async () => ({ cents: 16000, atLeast: false })),
      walletUrl: "https://zinc.test/wallet",
      ...over,
    };
  }
  function funded(zinc: ReturnType<typeof zincFake>, canBuy: boolean) {
    const h = harness({ zinc });
    h.store.canBuyResult = canBuy;
    h.store.settings.set("funding_lookahead_days", 21);
    h.store.settings.set("zinc_order_fee_cents", 100);
    return h;
  }

  it("never reads the wallet without paid features and Zinc connected", async () => {
    const zinc = zincFake();
    const h = funded(zinc, false);
    await h.tick("2027-02-11");
    expect(zinc.wallet).not.toHaveBeenCalled();
    expect(h.emails[0].text).not.toContain("Zinc");
  });

  it("warns when the next weeks' gifts are more than the balance, with the top-up link", async () => {
    const zinc = zincFake();
    const h = funded(zinc, true);
    await h.tick("2027-02-11");
    expect(zinc.lookahead).toHaveBeenCalledWith(USER, 21, 100);
    expect(h.emails[0].text).toContain("Your Zinc balance is low. $160 in gifts are due in the next 3 weeks, and you have $40.");
    expect(h.emails[0].text).toContain("Top up your Zinc balance: https://zinc.test/wallet");
  });

  it("says nothing when auto top-up is on, the balance covers it, or Zinc fails", async () => {
    for (const zinc of [
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: 4000, autoTopUp: true })) }),
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: 20000, autoTopUp: false })) }),
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: null, autoTopUp: false })) }),
      zincFake({ lookahead: vi.fn(async () => Promise.reject(new Error("down"))) }),
    ]) {
      const h = funded(zinc, true);
      await h.tick("2027-02-11");
      expect(h.sent()).toEqual(["heads_up@2027-02-11"]);
      expect(h.emails[0].text).not.toContain("Zinc balance is low");
    }
  });
});

// ─── ALL-32: held rounds, against the real local database (E5); only Zinc is faked ───


const stack = await localStack({ api: true });
const dbUp = stack !== null;
const local = stack?.supabase ?? null;

describe.skipIf(!dbUp)("held rounds (real local database, fake Zinc; ALL-32 AC-19, AC-22 to AC-24)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  const before = new Map<string, string>();
  /** Every email sent, by recipient. */
  const mail: { to: string; subject: string; text: string; day: CalendarDate }[] = [];
  let today: CalendarDate;
  let clockDay: CalendarDate;

  const SHARED = ["zinc_ordering_enabled", "round_engine_enabled"];
  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const key of SHARED) {
      before.set(key, (await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
      await pg.query("update concierge.app_settings set value = '1' where key = $1", [key]);
    }
    today = (await pg.query("select current_date::text as d")).rows[0].d;
  });
  afterAll(async () => {
    for (const [key, value] of before) await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    // Other test files flip these shared switches too, and put them back.
    for (const key of SHARED) await pg.query("update concierge.app_settings set value = '1' where key = $1", [key]);
    zinc = new FakeZinc((key) => users.some((u) => key === `zn_test_${u}`));
    refuse = false;
  });

  const client = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  /** When set, the email service refuses every send. */
  let refuse = false;
  const refuseTo = new Set<string>();
  const channel: Channel = {
    name: "email",
    send: async (email) => {
      if (refuse || refuseTo.has(email.to)) return { ok: false as const, error: "Refused" };
      mail.push({ to: email.to, subject: email.subject, text: email.text, day: clockDay });
      return { ok: true as const, id: `msg-${mail.length}` };
    },
  };

  /** Day `n` from today: today itself is "now", later days are at noon UTC (rounds are due from midnight). */
  const dayAt = (n: number) => (n === 0 ? new Date(Date.now() + 1000) : new Date(`${addDays(today, n)}T12:00:00Z`));

  /** The engine and the buying side wired to each other, as the app's routes do it. */
  function wiring(now: Date, o: { zinc?: boolean; engineClock?: () => number } = {}): { engine: EngineDeps; purchase: PurchaseDeps } {
    clockDay = now.toISOString().slice(0, 10);
    const clock = () => 0;
    const db = client();
    const purchase: PurchaseDeps = {
      db,
      http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
      env: "test",
      webhookBaseUrl: BASE,
      now,
      settings: { feeCents: 100, marginPct: 10 },
      advanceRound: (roundId) => advanceRound(roundId, engine, { justPlaced: true }),
      sleep: async () => {},
      clock,
    };
    const engine: EngineDeps = {
      clock: o.engineClock ?? clock,
      store: createSupabaseRoundStore(db),
      notify: { store: createSupabaseNotifyStore(db), channels: [channel], baseUrl: BASE, now },
      now,
      generateIdeas: async () => {},
      zinc:
        o.zinc === false
          ? null
          : {
              placeRound: (id, lock, deadlineMs, opts) => placeRound(id, lock, purchase, { deadlineMs, ...opts }),
              sweep: () => sweepStalePlacing(purchase),
              wallet: async () => ({ balanceCents: zinc.balance, autoTopUp: false }),
              lookahead: async () => ({ cents: 0, atLeast: false }),
              walletUrl: "https://zinc.test/wallet",
            },
    };
    return { engine, purchase };
  }
  const engine = (now: Date) => wiring(now).engine;
  const advance = (roundId: string, n: number, o: { zinc?: boolean } = {}) => advanceRound(roundId, wiring(dayAt(n), o).engine);
  /** The buyer approves today: approveAndBuy places it and, on a hold or failure, the engine tells them at once. */
  async function approve(u: User, r: { roundId: string; ideaIds: string[] }) {
    return approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, wiring(dayAt(0)).purchase);
  }

  type User = { userId: string; email: string };
  async function newUser(o: { connected?: boolean; autoTopUp?: boolean | null } = {}): Promise<User> {
    const userId = randomUUID();
    const email = `engine-${userId}@example.com`;
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, email],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, auto_topup_on) values ($1, true, '5555550100', $2)", [
      userId,
      o.autoTopUp === undefined ? false : o.autoTopUp,
    ]);
    if (o.connected ?? true) await connect(userId);
    return { userId, email };
  }
  const connect = (userId: string) =>
    pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${userId}`, `zn_whsec_${randomUUID()}`, randomUUID()]);

  /** A round awaiting approval, deadline in 30 days; its gifts (7 days at worst) still arrive if bought on the last day. */
  async function newRound(u: User, o: { totals?: number[]; listItems?: (string | null)[]; deadlineIn?: number } = {}) {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [u.userId],
    );
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.userId,
      person.rows[0].id,
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + $4::int + 10, current_date + $4::int, 20000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [u.userId, person.rows[0].id, occasion.rows[0].id, o.deadlineIn ?? 30],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    for (const [i, total] of (o.totals ?? [4200]).entries()) {
      const item = o.listItems?.[i] ?? null;
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, list_item_id)
         values ($1, $2, $3, 'https://shop.test/pending', $4, $4, 2, 3, 5, $5, $6, $7) returning id`,
        [u.userId, roundId, i === 0 ? "Stoneware mug set" : "Linen apron", total, i + 1, item ? "list" : "generated", item],
      );
      await pg.query("update concierge.gift_ideas set product_url = 'https://shop.test/p/' || id where id = $1", [idea.rows[0].id]);
      ideaIds.push(idea.rows[0].id);
    }
    return { roundId, ideaIds };
  }

  /** Approved the way approveAndBuy does it (held/retry), then "crashed" before placing. */
  async function approvedRound(u: User) {
    const { roundId, ideaIds } = await newRound(u);
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [roundId])).rows[0].locked_until;
    const orders = ideaIds.map((id) => ({
      idea_id: id,
      max_price_cents: 4520,
      fee_cents: 100,
      ship_to: "recipient",
      address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
    }));
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [roundId, u.userId, lock, JSON.stringify(orders)]);
    await pg.query("select concierge.release_round($1, $2)", [roundId, lock]);
    return { roundId, ideaIds };
  }

  const roundRow = async (roundId: string) =>
    (
      await pg.query(
        "select status::text as status, attention_reason, hold_count, locked_until, next_action_at from concierge.gift_rounds where id = $1",
        [roundId],
      )
    ).rows[0];
  const orderRows = async (roundId: string) =>
    (
      await pg.query(
        `select o.status, o.hold_reason, o.failure_type from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
          where o.round_id = $1 order by i.rank, o.created_at`,
        [roundId],
      )
    ).rows;
  const sends = async (roundId: string) =>
    (await pg.query("select step from concierge.round_sends where round_id = $1 order by created_at, step", [roundId])).rows.map((r) => r.step);
  /** Subjects this user got, as "subject@day-number". */
  const inbox = (u: User) => mail.filter((m) => m.to === u.email).map((m) => `${m.subject}@${dayNumber(m.day)}`);
  const dayNumber = (d: CalendarDate) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  const walletReads = () => zinc.calls.filter((c) => c === "GET /wallet/me").length;

  // ─── a list owner's shared address (ALL-112, T61) ─────────────────────────

  describe("whether a round has an address (ALL-63)", () => {
    const hasAddress = async (roundId: string) => {
      await pg.query("update concierge.gift_rounds set status = 'needs_address' where id = $1", [roundId]);
      return (await createSupabaseRoundStore(client()).roundContext(roundId)).hasAddress;
    };
    const personOf = async (roundId: string) =>
      (await pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id as string;
    const clearOwnEntry = async (roundId: string) =>
      pg.query("update public.people set address_line1 = null, city = null, state = null, zip = null where id = $1", [await personOf(roundId)]);

    it("a shared address counts when the buyer has none (AC-16)", async () => {
      const u = await newUser();
      const r = await newRound(u);
      await clearOwnEntry(r.roundId);
      await shareWith(r, u);
      expect(await hasAddress(r.roundId)).toBe(true);
    });

    it("with sharing off or the link revoked, it doesn't (AC-17)", async () => {
      const u = await newUser();
      const off = await newRound(u);
      await clearOwnEntry(off.roundId);
      const owner = await shareWith(off, u);
      await pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);
      expect(await hasAddress(off.roundId)).toBe(false);

      const revoked = await newRound(u);
      await clearOwnEntry(revoked.roundId);
      const other = await shareWith(revoked, u);
      await pg.query("update lists.lists set share_token = gen_random_uuid() where owner_id = $1", [other.userId]);
      expect(await hasAddress(revoked.roundId)).toBe(false);
    });

    it("a malformed shared row alone decides, even with a good entry of the buyer's (AC-18)", async () => {
      const u = await newUser();
      const r = await newRound(u);
      const owner = await shareWith(r, u);
      await pg.query("update public.account_addresses set state = 'Ohio' where user_id = $1", [owner.userId]);
      expect(await hasAddress(r.roundId)).toBe(false);
    });

    it("a failed read of the shared address can't hold up a round that doesn't need it", async () => {
      const u = await newUser();
      const r = await newRound(u);
      await pg.query("update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'funds' where id = $1", [r.roundId]);
      const real = client();
      const broken = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== "rpc") return Reflect.get(target, prop, receiver);
          return () => Promise.resolve({ data: null, error: { code: "XX000", message: "down" } });
        },
      });
      await expect(createSupabaseRoundStore(broken).roundContext(r.roundId)).resolves.toMatchObject({ hasAddress: true, hasSharedAddress: false });
    });

    it("with nothing shared, the buyer's own entry counts as before", async () => {
      const u = await newUser();
      const r = await newRound(u);
      expect(await hasAddress(r.roundId)).toBe(true);
    });
  });

  const WITHDRAWN = "we can't use the address Mary was sharing, so we didn't buy the Stoneware mug set and you haven't been charged for it.";
  const REJECTED = "the store couldn't use the address Mary saved, so we didn't buy the Stoneware mug set and you haven't been charged for it.";
  const ASKED = "We'll ask Mary to check it, without mentioning a gift.";

  /** A list owner sharing an address, and the round's person linked through their current share link. */
  async function shareWith(r: { roundId: string }, buyer: User): Promise<User> {
    const owner = await newUser();
    await pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
       values ($1, 'Sam', 'Rivera', '44 Shared St', 'Akron', 'OH', '44301', true)`,
      [owner.userId],
    );
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner.userId]);
    const person = (await pg.query("select person_id from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].person_id;
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      person,
      buyer.userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);
    await pg.query("update public.people set linked_user_id = $2 where id = $1", [person, owner.userId]);
    return owner;
  }
  /** The buyer approves against the shared address, and the order goes to Zinc. */
  async function placedToShared(u: User, o: { totals?: number[] } = {}) {
    const r = await newRound(u, o);
    const owner = await shareWith(r, u);
    await approve(u, r);
    // In the ideas' order: orders made in one transaction share created_at, so it can't order them.
    const rows = await pg.query(
      `select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
        where o.round_id = $1 and o.status = 'placing' order by i.rank`,
      [r.roundId],
    );
    return { ...r, owner, orderIds: rows.rows.map((x) => x.id as string) };
  }
  const zincRejects = (u: User, orderId: string) =>
    pg.query("select concierge.settle_order($1, $2, 'failed', 'invalid_shipping_address', null)", [u.userId, orderId]);
  const textFor = (u: User) => mail.filter((m) => m.to === u.email).map((m) => m.text);
  const snapshots = async (roundId: string) =>
    (
      await pg.query(
        "select count(*)::int as n from concierge.order_addresses x join concierge.orders o on o.id = x.order_id where o.round_id = $1 and o.failure_type = 'address_rejected'",
        [roundId],
      )
    ).rows[0].n;

  it("a gift held for an address goes to a shared address that arrives, with no email to fix it (ALL-63 AC-7)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approve(u, r);
    const [first] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await zincRejects(u, first.id);
    expect((await orderRows(r.roundId)).map((o) => o.hold_reason)).toContain("address");
    await shareWith(r, u);
    zinc.posts = [];

    await advance(r.roundId, 1);

    expect(zinc.posts).toEqual([expect.objectContaining({ city: "Akron" })]);
    expect(mail.filter((m) => m.to === u.email && /address/i.test(m.subject))).toEqual([]);
    const source = await pg.query("select address_source from concierge.orders where round_id = $1 and status = 'placing'", [r.roundId]);
    expect(source.rows).toEqual([{ address_source: "shared" }]);
  });

  it("sharing stopped after approval: the buyer is told once, and nothing is bought (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [
      r.roundId,
      u.userId,
      lock,
      JSON.stringify([
        {
          idea_id: r.ideaIds[0],
          max_price_cents: 4520,
          fee_cents: 100,
          ship_to: "recipient",
          address_source: "shared",
          address: { recipient_first_name: "Sam", recipient_last_name: "Rivera", address_line1: "44 Shared St", city: "Akron", state: "OH", zip: "44301", country: "US" },
        },
      ]),
    ]);
    await pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
    await pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);

    await advance(r.roundId, 1);
    await advance(r.roundId, 2);

    expect(zinc.posts).toEqual([]);
    expect(textFor(u)).toEqual([expect.stringContaining(WITHDRAWN)]);
    expect(textFor(owner)).toEqual([]);
  });

  it("Zinc rejected a shared address: the owner is asked first, neutrally, then the buyer is told (AC-9, AC-10, AC-12)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);

    await advance(roundId, 1);
    await advance(roundId, 2);

    const order = mail.map((m) => m.to);
    expect(order.indexOf(owner.email)).toBeLessThan(order.indexOf(u.email));
    expect(textFor(u)).toEqual([expect.stringContaining(`${REJECTED} ${ASKED}`)]);
    const [ownerEmail] = mail.filter((m) => m.to === owner.email);
    expect(mail.filter((m) => m.to === owner.email)).toHaveLength(1);
    expect(ownerEmail.subject).toBe("Please check your saved address");
    expect(ownerEmail.text).toContain("Please check your saved address is current. It's used if someone sends you a gift through your list.");
    for (const secret of ["Mary", "Stoneware", u.email, roundId]) expect(ownerEmail.text).not.toContain(secret);
    const rows = await pg.query("select round_id from concierge.notifications where user_id = $1", [owner.userId]);
    expect(rows.rows).toEqual([{ round_id: null }]);
    const links = await pg.query("select round_id, action from concierge.action_links where user_id = $1", [owner.userId]);
    expect(links.rows).toEqual([{ round_id: null, action: "check_my_address" }]);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("two picks rejected: one email to the owner, and the buyer's names both (AC-9, AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u, { totals: [2000, 2000] });
    for (const id of orderIds) await zincRejects(u, id);

    await advance(roundId, 1);

    expect(mail.filter((m) => m.to === owner.email)).toHaveLength(1);
    const [text] = textFor(u);
    expect(textFor(u)).toHaveLength(1);
    expect(text).toContain("the Stoneware mug set");
    expect(text).toContain("the Linen apron");
    expect(text).toContain("You haven't been charged for either.");
  });

  it("the owner already changed the address: no email to them, and the buyer isn't promised one (AC-11, AC-13)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await pg.query("update public.account_addresses set address_line2 = 'Apt 3' where user_id = $1", [owner.userId]);

    await advance(roundId, 1);

    expect(textFor(owner)).toEqual([]);
    expect(textFor(u)[0]).toContain(REJECTED);
    expect(textFor(u)[0]).not.toContain(ASKED);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a refused email to the owner doesn't stop the buyer's, and the tick tries again (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    refuseTo.add(owner.email);

    await advance(roundId, 1);
    expect(textFor(u)[0]).toContain(`${REJECTED} ${ASKED}`);
    expect(textFor(owner)).toEqual([]);
    expect(await snapshots(roundId)).toBe(1);

    refuseTo.delete(owner.email);
    await tellOwnersOfRejections(engine(dayAt(2)));
    await tellOwnersOfRejections(engine(dayAt(3)));
    expect(textFor(owner)).toHaveLength(1);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a rejection after the round closed still tells the owner, once, with the buyer's late email (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await pg.query("select concierge.cancel_held($1, 'deadline')", [roundId]);
    await zincRejects(u, orderIds[0]);

    await tellOrdered(roundId, engine(dayAt(1)));
    await tellOwnersOfRejections(engine(dayAt(1)));
    await tellOrdered(roundId, engine(dayAt(2)));
    await tellOwnersOfRejections(engine(dayAt(2)));

    expect(textFor(owner)).toHaveLength(1);
    expect(mail.filter((m) => m.to === u.email).map((m) => m.subject)).toEqual([expect.stringContaining("we couldn't buy")]);
  });

  it("a price failure already open doesn't hide the address email (AC-9)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u, { totals: [2000, 2000] });
    await pg.query("select concierge.settle_order($1, $2, 'failed', 'price_up', null)", [u.userId, orderIds[0]]);
    await advance(roundId, 1);
    await zincRejects(u, orderIds[1]);
    await advance(roundId, 2);

    const texts = textFor(u);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain("the store couldn't use the address Mary saved, so we didn't buy the Linen apron");
  });

  it("a pick still placing isn't said to be free when another ends (AC-16)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u, { totals: [2000, 2000] });
    await zincRejects(u, orderIds[1]);
    await advance(roundId, 1);
    expect(textFor(u)[0]).toContain("didn't buy the Linen apron and you haven't been charged for it.");
    expect(textFor(u)[0]).not.toContain("Stoneware");
  });

  it("sharing stopped with two picks: one email, naming both (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [2000, 2000] });
    const owner = await shareWith(r, u);
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [
      r.roundId,
      u.userId,
      lock,
      JSON.stringify(
        r.ideaIds.map((id) => ({
          idea_id: id,
          max_price_cents: 2100,
          fee_cents: 100,
          ship_to: "recipient",
          address_source: "shared",
          address: { recipient_first_name: "Sam", recipient_last_name: "Rivera", address_line1: "44 Shared St", city: "Akron", state: "OH", zip: "44301", country: "US" },
        })),
      ),
    ]);
    await pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
    await pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);
    const log = vi.spyOn(console, "log");
    try {
      await advance(r.roundId, 1);
      const lines = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("order.address_withdrawn");
      for (const secret of ["44 Shared St", "Rivera", "Akron", owner.userId]) expect(lines).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
    expect(zinc.posts).toEqual([]);
    const [text] = textFor(u);
    expect(textFor(u)).toHaveLength(1);
    expect(text).toContain("the Stoneware mug set");
    expect(text).toContain("the Linen apron");
    expect(text).toContain("You haven't been charged for either.");
  });

  it("the person now links someone else: neither owner is emailed (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const person = (await pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id;
    await pg.query("delete from lists.person_links where person_id = $1", [person]);
    const other = await shareWith({ roundId }, u);
    await pg.query("update public.account_addresses set address_line1 = '9 Other Rd' where user_id = $1", [other.userId]);

    await advance(roundId, 1);

    expect(textFor(owner)).toEqual([]);
    expect(textFor(other)).toEqual([]);
    expect(textFor(u)[0]).not.toContain(ASKED);
  });

  it("an owner with no email address is ruled out (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await pg.query("update auth.users set email = null where id = $1", [owner.userId]);

    await advance(roundId, 1);

    expect(textFor(u)[0]).not.toContain(ASKED);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a failed lookup isn't ruled out: nothing is cleared, and the buyer isn't promised an ask (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const deps = engine(dayAt(1));
    const broken = { ...deps, store: { ...deps.store, sharedAddressOwnerToTell: async () => { throw new Error("down"); } } };

    expect(await tellOwnerOfRejection(roundId, broken)).toBe("retry");
    expect(await snapshots(roundId)).toBe(1);
  });

  it("the buyer cancelled the round: the tick still tells the owner (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await pg.query("select concierge.cancel_held($1, 'cancel')", [roundId]);

    await tellOwnersOfRejections(engine(dayAt(1)));

    expect(textFor(owner)).toHaveLength(1);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("an email kept being refused: after the retry window it gives up and deletes the address (AC-10, AC-13)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    refuseTo.add(owner.email);

    await tellOwnersOfRejections(engine(dayAt(2)));
    expect(await snapshots(roundId)).toBe(1);

    const log = vi.spyOn(console, "log");
    try {
      await tellOwnersOfRejections(engine(dayAt(8)));
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("order.shared_address_notice_abandoned");
    } finally {
      log.mockRestore();
    }
    expect(await snapshots(roundId)).toBe(0);
    expect(await sends(roundId)).not.toContain("shared_address");
    expect(textFor(owner)).toEqual([]);
  });

  it("two runs racing: the one that loses leaves the address, so a refused send can be tried again (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const deps = engine(dayAt(1));
    const lost = { ...deps, store: { ...deps.store, recordSend: async () => false } };

    expect(await tellOwnerOfRejection(roundId, lost)).toBe("asked");
    expect(await snapshots(roundId)).toBe(1);
  });

  it("logs ids only, with no address, name or owner in the buyer's round events (AC-15)", async () => {
    const log = vi.spyOn(console, "log");
    try {
      const u = await newUser();
      const { roundId, orderIds, owner } = await placedToShared(u);
      await zincRejects(u, orderIds[0]);
      await advance(roundId, 1);
      const lines = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("order.shared_address_notice");
      for (const secret of ["44 Shared St", "Rivera", "Akron", owner.userId, owner.email]) expect(lines).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  it("tells the buyer on the hold day, tries placing daily, reminds at -7 and -2, then skips at the deadline", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;

    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    for (let day = 1; day < 30; day++) expect(await advance(r.roundId, day)).toBe("advanced");
    const waiting = "Sorry, Mary's gift is waiting on your Zinc balance";
    expect(inbox(u)).toEqual([`${waiting}@0`, `${waiting}@23`, `${waiting}@28`]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:1:reminder", "hold:1:final"]));
    // One look at the wallet a day, and nothing ever sent to Zinc.
    expect(walletReads()).toBe(30);
    expect(zinc.posts).toEqual([]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds", locked_until: null });

    expect(await advance(r.roundId, 30)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped", next_action_at: null, locked_until: null });
    expect(await orderRows(r.roundId)).toEqual([{ status: "cancelled", hold_reason: "funds", failure_type: "held_expired" }]);
    const last = mail.filter((m) => m.to === u.email).at(-1)!;
    expect(last.subject).toBe("Sorry, we couldn't buy Mary's gift in time");
    expect(last.text).toContain("couldn't be bought in time, so we didn't buy it and you haven't been charged.");
  }, 60_000);

  // S1: the app builds its wiring (and its `now`) when the request starts; reconcile_round then
  // makes the round due at the database's later now(). The hold notice must still go out in the
  // same request, not wait for the next tick.
  it("approving into a funds hold emails the buyer in the same request, with the wiring's clock behind the database's", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    const { purchase } = wiring(new Date(Date.now() - 5000));
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, purchase)).toEqual({
      ok: true,
      status: "held",
      reason: "funds",
    });
    expect(await sends(r.roundId)).toContain("hold:1:notice");
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
    expect(await roundRow(r.roundId)).toMatchObject({ locked_until: null });
  });

  // S6 (owner): the round engine switch doesn't stop a customer hearing about their purchase.
  it("with the round engine switched off, a hold from approval is still emailed at once", async () => {
    await pg.query("update concierge.app_settings set value = '0' where key = 'round_engine_enabled'");
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
    expect(await roundRow(r.roundId)).toMatchObject({ locked_until: null });
    // The ordinary path stays off: nothing but the money path moves.
    expect(await advance(r.roundId, 23)).toBe("off");
  });

  // S3: one placing budget per run, set by the engine when the run (the tick) starts and shared
  // by every round it places; once it's spent nothing more is sent to Zinc, and the round still
  // gets what's due (the next tick tries placing again). Here the run's clock is already past it.
  it("stops placing once the run's placing budget is spent", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    let calls = 0;
    // The budget is set on the run's first look at the clock; every later look is past it.
    const engineClock = () => (calls++ === 0 ? 0 : 10_000_000);
    const log = vi.spyOn(console, "log");
    expect(await advanceRound(r.roundId, wiring(dayAt(1), { engineClock }).engine)).toBe("advanced");
    expect(zinc.posts).toEqual([]);
    const spent = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "order.place_budget_spent");
    expect(spent).toEqual([expect.objectContaining({ round_id: r.roundId })]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry", locked_until: null });
    // Within the budget it places.
    expect(await advanceRound(r.roundId, wiring(dayAt(2)).engine)).toBe("advanced");
    expect(zinc.posts).toHaveLength(1);
  });

  it("names the amounts and says the cost plainly (no Alpha label) and carries the cancel link in the hold email", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    const [m] = mail.filter((x) => x.to === u.email);
    expect(m.text).toContain("Zinc needs $46.20 (the gift with room for a small price change");
    expect(m.text).toContain("You have $10, so you're $36.20 short.");
    expect(m.text).toContain("Top up your Zinc balance: https://zinc.test/wallet");
    expect(m.text).toContain("Topping up means we'll buy the gift: its price plus Zinc's $1 fee.");
    expect(m.text).toMatch(/Cancel this gift: https:\/\/giftsaf\.test\/a\/\S+/);
  });

  it("sends one 'still short' email a day after a partial top-up (AC-22)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    zinc.balance = 3000;
    expect(await advance(r.roundId, 1)).toBe("advanced");
    // The same day again: today's key is taken, nothing more is sent.
    await advanceRound(r.roundId, engine(new Date(`${addDays(today, 1)}T18:00:00Z`)));
    await advance(r.roundId, 2); // no change in the balance
    zinc.balance = 3500;
    await advance(r.roundId, 3);
    expect(inbox(u)).toEqual([
      "Sorry, Mary's gift is waiting on your Zinc balance@0",
      "You're still $16.20 short for Mary's gift@1",
      "You're still $11.20 short for Mary's gift@3",
    ]);
  });

  it("sends a new notice when the reason changes from setup to funds", async () => {
    const u = await newUser({ connected: false });
    const r = await newRound(u);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "setup", hold_count: 1 });
    await connect(u.userId);
    zinc.balance = 1000;
    await advance(r.roundId, 1);
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "funds", hold_count: 2 });
    expect(inbox(u)).toEqual(["Finish setting up payment to send Mary's gift@0", "Sorry, Mary's gift is waiting on your Zinc balance@1"]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:2:notice"]));
  });

  it("buys it once the balance covers it, and stops emailing", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    zinc.balance = 100_000;
    await advance(r.roundId, 23); // the reminder day: placing comes first, so no reminder goes out
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect(zinc.posts).toHaveLength(1);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
  });

  it("at the deadline, one placing and one held → the cancel email first (retried if refused), then ordered", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    // Auto top-up unknown: both are sent; Zinc takes the first and refuses the second.
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
    const before = inbox(u).length;
    // Refused: nothing is cancelled or closed, and the next look tries again.
    refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing", "held"]);
    refuse = false;
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 31);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing", "cancelled"]);
    expect(inbox(u).slice(before)).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@31"]);
    const last = mail.filter((m) => m.to === u.email).at(-1)!;
    expect(last.text).toContain("We couldn't buy the Linen apron for Mary's Christmas in time, so we cancelled it. You haven't been charged for it.");
    // The placing one isn't confirmed yet: its own emails say what happens to it.
    expect(last.text).not.toContain("on its way");
    expect(last.text).not.toContain("No gift");
  });

  it("at the deadline, one unconfirmed and one held → the cancel email, then 'still confirming' on the next look", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [first] = (await pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    await pg.query("select concierge.mark_unconfirmed($1)", [first.id]);
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    await advance(r.roundId, 31);
    expect(inbox(u).slice(before)).toEqual([
      "Sorry, we couldn't buy all of Mary's gifts in time@30",
      "We're confirming Mary's gift with the store@31",
    ]);
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["unconfirmed", "cancelled"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
  });

  it("at the deadline, with the placed one already confirmed: the same email, sent before closing", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (await pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    await pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, first.id]);
    // The email service is down at the deadline: nothing closes, and the next look tries again.
    refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention" });
    refuse = false;
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    expect(await advance(r.roundId, 31)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    expect(inbox(u).filter((m) => m.startsWith("Sorry, we couldn't buy all of Mary's gifts"))).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@31"]);
  });

  it("tells the buyer it was on us when our switch kept the gift back past the deadline (missed_on_us)", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    // What placeRound does when zinc_ordering_enabled is 0 (set here, not flipped: the switch is shared).
    await pg.query("select concierge.gate_held_orders($1, 'paused')", [r.roundId]);
    await advance(r.roundId, 30);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    const [m] = mail.filter((x) => x.to === u.email);
    expect(m.subject).toBe("We're sorry, we couldn't send Mary's gift in time");
    expect(m.text).toContain("That's on us, and we're sorry. Nothing was bought and you haven't been charged.");
  });

  // S8: ordering switched off while a gift waits on funds: no "top up" reminders (topping up
  // wouldn't buy it), and the deadline says it was on us, not "skipped".
  it("with ordering switched off, a funds hold gets no reminders and the deadline sends missed_on_us", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    await pg.query("update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled'");
    for (const day of [1, 23, 28]) expect(await advance(r.roundId, day)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "funds" });
    expect(await advance(r.roundId, 30)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0", "We're sorry, we couldn't send Mary's gift in time@30"]);
    expect(zinc.posts).toEqual([]);
  });

  // Re-review: the sweep marks an order unconfirmed and the buyer hears "still confirming" in the
  // same run (owner: customers are always told), and the owner gets an alert (E8).
  it("the sweep tells the buyer at once when Zinc can't find an order, and alerts the owner", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [o] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    const log = vi.spyOn(console, "log");
    await sweepStalePlacing(wiring(new Date(Date.now() + 31 * 60_000)).purchase);
    expect((await pg.query("select status from concierge.orders where id = $1", [o.id])).rows[0].status).toBe("unconfirmed");
    expect(await sends(r.roundId)).toContain("hold:1:notice");
    expect(mail.filter((m) => m.to === u.email).map((m) => m.subject)).toEqual(["We're confirming Mary's gift with the store"]);
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "order.unconfirmed" && e.order_id === o.id);
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
  });

  it("an unconfirmed order: told at once, again at the deadline, never skipped", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    // The sweep couldn't find it at Zinc.
    const [order] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await pg.query("select concierge.mark_unconfirmed($1)", [order.id]);

    await advance(r.roundId, 1);
    await advance(r.roundId, 10);
    await advance(r.roundId, 30);
    await advance(r.roundId, 31);
    const confirming = "We're confirming Mary's gift with the store";
    expect(inbox(u)).toEqual([`${confirming}@1`, `${confirming}@30`]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
    expect(mail.filter((m) => m.to === u.email).every((m) => !m.text.includes("nothing was bought"))).toBe(true);
  });

  it("a hold that starts 5 days before the deadline: one email that run; the reminder and final come on later days", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: 5 });
    zinc.balance = 1000;
    await approve(u, r);
    const waiting = "Sorry, Mary's gift is waiting on your Zinc balance";
    expect(inbox(u)).toEqual([`${waiting}@0`]);
    expect(await sends(r.roundId)).toEqual(["hold:1:notice"]);
    await advance(r.roundId, 1);
    await advance(r.roundId, 2);
    await advance(r.roundId, 3);
    expect(inbox(u)).toEqual([`${waiting}@0`, `${waiting}@1`, `${waiting}@3`]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:1:reminder", "hold:1:final"]));
  });

  it("a deadline email the email service refuses is tried again on the next look; the round closes only once it went", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
    expect(await sends(r.roundId)).not.toContain("skipped");
    refuse = false;
    // The failed run's lease runs out by itself; here it's given back so the next look can claim it.
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    expect(await advance(r.roundId, 31)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u).at(-1)).toBe("Sorry, we couldn't buy Mary's gift in time@31");
  });

  it("tells the buyer once per order when Zinc confirms it placed (the ordered email, city only)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    await approve(u, r);
    const placed = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    for (const o of placed) await pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, o.id]);
    const deps = engine(dayAt(1));
    await tellOrdered(r.roundId, deps);
    await tellOrdered(r.roundId, deps);
    expect(inbox(u)).toEqual(["Mary's gift is ordered@1", "Mary's gift is ordered@1"]);
    const texts = mail.filter((m) => m.to === u.email).map((m) => m.text);
    expect(texts.some((t) => t.includes("We ordered the Stoneware mug set for Mary's Christmas"))).toBe(true);
    expect(texts.some((t) => t.includes("We ordered the Linen apron for Mary's Christmas"))).toBe(true);
    for (const t of texts) {
      expect(t).toContain("It's on its way to Dayton. We'll let you know when it ships.");
      expect(t).not.toContain("12 Oak St");
    }
    expect((await sends(r.roundId)).filter((s: string) => s.startsWith("ordered:"))).toHaveLength(2);
  });

  it("if the placing gift fails while the round closes, the late email tells it, not 'skipped' (ALL-116 AC-6)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (await pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    const deps = engine(dayAt(30));
    const real = deps.store;
    // Zinc reports the placing one failed just as the deadline closes the round.
    deps.store = {
      ...real,
      cancelHeld: async (roundId) => {
        await pg.query("select concierge.settle_order($1, $2, 'failed', 'out_of_stock', '{}')", [u.userId, first.id]);
        return real.cancelHeld(roundId);
      },
    };
    const before = inbox(u).length;
    await advanceRound(r.roundId, deps);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u).slice(before)).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@30", "We're sorry, we couldn't buy Mary's gift@30"]);
  });

  it("alerts the owner when a refused deadline email keeps a round open past its deadline", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    refuse = true;
    const log = vi.spyOn(console, "log");
    await advance(r.roundId, 30);
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_deadline_email_held_open")).toEqual([]);
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 31);
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_deadline_email_held_open");
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
    expect(Object.keys(alerts[0]).sort()).toEqual(["alert", "at", "event", "round_id", "user_id"]);
  });

  // S2 (owner: customers are always told): a gift still placing at the deadline fails afterwards,
  // or the owner settles an unconfirmed one as failed. The round is closed, so the engine never
  // looks at it again; the buyer still hears, once.
  it("a failure settled after the round closed is emailed (at once, or on the next tick), and only once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    // The first times out (placing); the second is never sent and stays held.
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [first] = (
      await pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])
    ).rows;
    // The deadline cancels the held one (its own email) and closes the round with the first still placing.
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 30);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    const before = inbox(u).length;

    // Zinc's webhook: it failed. The round ends skipped, and the engine never looks at it again.
    await pg.query("select concierge.settle_order($1, $2, 'failed', 'out_of_stock', '{}')", [u.userId, first.id]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    // The webhook tells the buyer at once (orderPlaced → tellOrdered); refused that time...
    refuse = true;
    await tellOrdered(r.roundId, engine(dayAt(31)));
    expect(await sends(r.roundId)).not.toContain(`late_fail:${first.id}`);
    refuse = false;
    // ...so the tick sends it, once.
    await retryOrderedEmails(engine(dayAt(32)));
    await retryOrderedEmails(engine(dayAt(33)));
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy Mary's gift@32"]);
    const text = mail.filter((m) => m.to === u.email && m.subject.startsWith("We're sorry, we couldn't buy")).map((m) => m.text)[0];
    expect(text).toContain(
      "We know you were counting on the Stoneware mug set for Mary's Christmas on",
    );
    expect(text).toContain("The store ran out. You haven't been charged for it.");
    expect(text).not.toContain("on its way");
  });

  it("an unconfirmed order the owner settles as failed after the deadline is emailed, and the round ends skipped", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [o] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await pg.query("select concierge.mark_unconfirmed($1)", [o.id]);
    await advance(r.roundId, 1);
    await advance(r.roundId, 30);
    // Runbook in design/operations.md: Zinc has no such order, so the owner settles it as failed.
    await pg.query("select concierge.settle_order($1, $2, 'failed', 'failed', null)", [u.userId, o.id]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    await retryOrderedEmails(engine(dayAt(31)));
    expect(inbox(u).at(-1)).toBe("We're sorry, we couldn't buy Mary's gift@31");
    expect(await sends(r.roundId)).toContain(`late_fail:${o.id}`);
  });

  it("a refused 'ordered' email goes out on the next tick, and never twice", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    await approve(u, r);
    const [o] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, o.id]);
    refuse = true;
    await tellOrdered(r.roundId, engine(dayAt(1)));
    expect(await sends(r.roundId)).not.toContain(`ordered:${o.id}`);
    refuse = false;
    await retryOrderedEmails(engine(dayAt(2)));
    await retryOrderedEmails(engine(dayAt(3)));
    expect(inbox(u).filter((m) => m.startsWith("Mary's gift is ordered"))).toEqual(["Mary's gift is ordered@2"]);
  });

  it("emails a failed order at once, keyed by the order (fail:<id>, ALL-116), and only once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, [{ status: 400, code: "out_of_stock" }]);
    expect(await approve(u, r)).toEqual({ ok: true, status: "failed", reason: "out_of_stock" });
    await advance(r.roundId, 1);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "out_of_stock" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@0"]);
    const [o] = (await pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    expect(await sends(r.roundId)).toEqual([`fail:${o.id}`]);
  });

  it("with Zinc unreachable all along, says so once on the final hold day", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    await advance(r.roundId, 27, { zinc: false });
    await advance(r.roundId, 28, { zinc: false });
    await advance(r.roundId, 29, { zinc: false });
    expect(inbox(u)).toEqual(["Sorry, we're having trouble ordering Mary's gift@28"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry" });
  });

  it("the cancel link cancels the held gift, skips the round and releases the list pick (AC-24)", async () => {
    const u = await newUser();
    const owner = await newUser();
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id", [owner.userId]);
    const item = await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Vase', 4000) returning id", [list.rows[0].id]);
    const r = await newRound(u, { listItems: [item.rows[0].id] });
    zinc.balance = 1000;
    await approve(u, r);
    expect((await pg.query("select count(*)::int as n from lists.gift_claims where item_id = $1", [item.rows[0].id])).rows[0].n).toBe(1);

    const [m] = mail.filter((x) => x.to === u.email);
    const token = m.text.match(/Cancel this gift: https:\/\/giftsaf\.test\/a\/(\S+)/)![1];
    const store = createSupabaseNotifyStore(client());
    const result = await confirmActionLink(token, u.userId, { store, now: new Date() });
    expect(result).toMatchObject({
      state: "done",
      done: { title: "Cancelled", body: "We cancelled the gift that was waiting, so nothing was bought or charged for it. Nothing more will be bought for this occasion." },
    });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(await orderRows(r.roundId)).toEqual([{ status: "cancelled", hold_reason: "funds", failure_type: "cancelled" }]);
    expect((await pg.query("select count(*)::int as n from lists.gift_claims where item_id = $1", [item.rows[0].id])).rows[0].n).toBe(0);
    // Someone else's round can't be cancelled through it.
    expect(await store.cancelHeldGift(r.roundId, owner.userId)).toBeNull();
  });

  // N2: the done page says what actually happened.
  it("the cancel link's done page says when the gift was already being ordered and nothing was cancelled", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1000;
    await approve(u, r);
    const [m] = mail.filter((x) => x.to === u.email);
    const token = m.text.match(/Cancel this gift: https:\/\/giftsaf\.test\/a\/(\S+)/)![1];
    // Topped up, and the next try sent it before the buyer tapped the link.
    zinc.balance = 100_000;
    await advance(r.roundId, 1);
    expect(await orderRows(r.roundId)).toEqual([expect.objectContaining({ status: "placing" })]);
    const result = await confirmActionLink(token, u.userId, { store: createSupabaseNotifyStore(client()), now: new Date() });
    expect(result).toMatchObject({
      state: "done",
      done: {
        title: "Already being ordered",
        body: "The gift was already being ordered, so there was nothing left to cancel. We'll email you once the store confirms it.",
      },
    });
    expect(await orderRows(r.roundId)).toEqual([expect.objectContaining({ status: "placing" })]);
  });
  // ─── ALL-116: every failure is told, once, with the right gift and reason ───

  /** A round whose picks are all placing, ids in rank order. (A Zinc timeout stops the run, so only
   *  the first would really be placing: the rest are moved there directly, as a later run would.) */
  async function placingRound(u: User, totals = [4200, 3000]) {
    const r = await newRound(u, { totals });
    for (const id of r.ideaIds) zinc.plan.set(`https://shop.test/p/${id}`, ["timeout"]);
    await approve(u, r);
    await pg.query("update concierge.orders set status = 'placing', hold_reason = null where round_id = $1 and status = 'held'", [r.roundId]);
    await pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    const rows = await pg.query(
      "select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank",
      [r.roundId],
    );
    return { ...r, orderIds: rows.rows.map((x) => x.id as string) };
  }
  const settleFailed = (u: User, orderId: string, type: string) =>
    pg.query("select concierge.settle_order($1, $2, 'failed', $3, null)", [u.userId, orderId, type]);
  const lastText = (u: User) => mail.filter((m) => m.to === u.email).at(-1)!.text;

  it("two failures before one email: one summary names both, each with its reason (AC-1)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    await settleFailed(u, r.orderIds[0], "price_up");
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 1);
    expect(inbox(u).slice(before)).toEqual(["Sorry, 2 of Mary's Christmas gifts couldn't be bought@1"]);
    const text = lastText(u);
    expect(text).toContain("and neither of them went through.");
    expect(text).toContain("- Stoneware mug set (The price went up more than you allowed for. Approve the new price, or choose another gift.)");
    expect(text).toContain("- Linen apron (The store ran out. Choose another gift.)");
    expect(text).toContain("Review the new price for the Stoneware mug set:");
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(r.orderIds.map((id) => `fail:${id}`)));
    // The price failure can still be re-approved.
    const priceUp = await pg.query("select status, failure_type, resolved from concierge.orders where id = $1", [r.orderIds[0]]);
    expect(priceUp.rows[0]).toEqual({ status: "failed", failure_type: "price_up", resolved: false });
    // Told once.
    await pg.query("update concierge.gift_rounds set next_action_at = now() where id = $1", [r.roundId]);
    await advance(r.roundId, 2);
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("a later failure is told on its own, and the gift named is the one that failed (AC-2, AC-3)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    // The one created second fails first...
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    await advance(r.roundId, 1);
    expect(lastText(u)).toContain("The store ran out of the Linen apron");
    // ...and the one created first fails last.
    await settleFailed(u, r.orderIds[0], "too_late");
    await advance(r.roundId, 2);
    expect(inbox(u).slice(-2)).toEqual(["Sorry, Mary's gift is out of stock@1", "Sorry, Mary's gift can't arrive in time@2"]);
    expect(lastText(u)).toContain("The Stoneware mug set wouldn't arrive in time");
    expect(lastText(u)).not.toContain("Linen apron");
  });

  it("a failure next to an unconfirmed order is told, not hidden behind 'still confirming' (AC-4)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    await pg.query("select concierge.mark_unconfirmed($1)", [r.orderIds[0]]);
    await advance(r.roundId, 1);
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    await advance(r.roundId, 2);
    expect(inbox(u)).toContain("Sorry, Mary's gift is out of stock@2");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
  });

  it("a failure on the ship-by day with nothing else: 'We couldn't buy it' with the reason, not 'No gift' (AC-7)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy Mary's gift@30"]);
    expect(lastText(u)).toContain("The store ran out. You haven't been charged for it.");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(await sends(r.roundId)).not.toContain("skipped");
  });

  it("on the ship-by day, an untold failure and a held gift: one email names both (owner, AC-5)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (
      await pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])
    ).rows;
    await settleFailed(u, first.id, "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy 2 of Mary's Christmas gifts@30"]);
    const text = lastText(u);
    expect(text).toContain("- Stoneware mug set (The store ran out.)");
    expect(text).toContain("- Linen apron (It couldn't be bought in time, so we cancelled it.)");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
  });

  it("a refused failure email is logged for the owner, still lets the run go on, and goes on the next look (AC-11)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const log = vi.spyOn(console, "log");
    refuse = true;
    expect(await advance(r.roundId, 1)).toBe("advanced");
    refuse = false;
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_failure_email_failed");
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
    expect(await sends(r.roundId)).not.toContain(`fail:${r.orderIds[0]}`);
    await advance(r.roundId, 2);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@2"]);
  });

  it("closed early with a failure untold (the cancel link): the late email tells it and says it stopped early (AC-5, AC-13)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "price_up");
    await pg.query("select concierge.cancel_held($1, 'cancel')", [r.roundId]);
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u)).toEqual(["We're sorry, we couldn't buy Mary's gift@1"]);
    expect(lastText(u)).toContain("The price went up more than you allowed for. You haven't been charged for it.");
    expect(lastText(u)).toContain("this occasion's gifts were stopped early");
    expect(lastText(u)).toContain("Open Mary's page:");
  });

  it("a removed person with a failure untold: still told, and the button doesn't open their page (owner)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const person = (await pg.query("select person_id from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].person_id;
    await pg.query("update public.people set deleted_at = now() where id = $1", [person]);
    await pg.query("select concierge.skip_open_rounds($1, null)", [person]);
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u)).toEqual(["We're sorry, we couldn't buy Mary's gift@1"]);
    expect(lastText(u)).toContain("Open GiftsAF:");
    expect(lastText(u)).not.toContain("Open Mary's page");
  });

});
