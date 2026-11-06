import { addDays, compareDates, type CalendarDate, type ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Channel } from "../notify/channels";
import { advanceRound, resumeRoundsForPerson, runTick, type EngineDeps } from "../rounds/engine";
import { FakeRoundStore } from "./fake-round-store";
import { FakeStore } from "./fake-store";

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

function harness(opts: { hasAddress?: boolean; candidateFrom?: CalendarDate } = {}) {
  const store = new FakeRoundStore();
  store.settings.set("round_engine_enabled", 1);
  store.settings.set("round_lock_minutes", 10);
  store.settings.set("round_max_attempts", 3);
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
  it("does nothing but log when the engine is off (AC-2)", async () => {
    const h = harness();
    h.store.settings.set("round_engine_enabled", 0);

    const summary = await h.tick("2027-02-11");

    expect(summary).toEqual({ enabled: false, created: 0, advanced: 0, failed: 0 });
    expect(h.store.writes).toEqual([]);
    expect(h.notifyStore.notifications).toEqual([]);
    expect(events()).toEqual([expect.objectContaining({ event: "round_tick", enabled: false })]);
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
    expect(final.text).toContain("by Thu, Mar 11");

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
