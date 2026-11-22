import { addDays, compareDates, type CalendarDate, type ScheduleSettings } from "@gifts-af/core";
import { afterEach, beforeEach, vi, type MockInstance } from "vitest";
import type { Channel } from "../notify/channels";
import { runTick, type EngineDeps, type EngineZinc, type GenerateIdeas } from "../rounds/engine";
import { FakeRoundStore } from "./fake-round-store";
import { FakeStore } from "./fake-store";

// The round engine against fake stores: the harness, the shared schedule and ids, and the
// logged events. Used by the round-engine-*.test.ts files.

// Birthday 2027-03-20 with the default settings: deadline 03-11, start 02-11,
// heads-up 02-11, reminder 1 02-16, reminder 2 03-04, final notice 03-09.
export const SCHEDULE: ScheduleSettings = {
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
export const USER = "user-1";
export const PERSON = "person-1";
export const OCCASION = "occasion-1";
export const NAME = "Zelda Quartermain";
export const EMAIL = "buyer@example.com";
export const BASE = "https://giftsaf.test";

export const at = (day: CalendarDate, time = "12:00:00") => new Date(`${day}T${time}Z`);

export type Sent = Parameters<Channel["send"]>[0];

export function harness(opts: { hasAddress?: boolean; candidateFrom?: CalendarDate; zinc?: EngineZinc } = {}) {
  const store = new FakeRoundStore();
  store.settings.set("round_engine_enabled", 1);
  store.settings.set("round_lock_minutes", 10);
  store.settings.set("round_max_attempts", 3);
  store.settings.set("zinc_place_budget_ms", 45_000);
  // The idea pass (ALL-27): the shipped timings, and room for several rounds a tick.
  store.settings.set("tick_deadline_ms", 270_000);
  store.settings.set("idea_rounds_per_tick", 5);
  store.settings.set("idea_ai_timeout_ms", 60_000);
  store.settings.set("idea_zinc_timeout_ms", 15_000);
  store.settings.set("idea_list_lookups_max", 10);
  store.settings.set("zinc_requests_per_second", 10);
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
  /** A run that saves two ideas, as runIdeas does (a fake: the run itself is idea-run.test.ts). */
  const generateIdeas = vi.fn<GenerateIdeas>(async (round) => {
    if (!store.ideas.has(round.id)) {
      store.ideas.set(round.id, [
        { id: "idea-1", title: "Stoneware mug set", totalCents: 4200, arriveBy: "2027-03-05", reason: "Loves tea." },
        { id: "idea-2", title: "Herb planter", totalCents: 3850, arriveBy: "2027-03-06", reason: "Likes plants." },
      ]);
    }
    return { status: "saved", count: 2 };
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
/** The events logged in this test, parsed (E6). */
export const events = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
export const named = (name: string) => events().filter((e) => e.event === name);

/** Silences console.log in each test and keeps what was logged, for events() and named(). */
export function captureLog(): void {
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
  });
}
