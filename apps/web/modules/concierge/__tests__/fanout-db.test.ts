// Fan-out jobs (ALL-125) against the real local database (E5): the round lease, placing and the
// idea runs' daily limit are the database's own behaviour. Only Zinc, email and the AI are faked
// (no paid calls). Every job builds its own Supabase client, so the database sees separate,
// concurrent requests. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { addDays, type CalendarDate, type Database } from "@gifts-af/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { Channel } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { createSupabaseIdeaStore } from "../ideas/store";
import { placeRound } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import { advanceRound, runBuyerMessage, runRoundMessage, runTick, type EngineDeps, type GenerateIdeas } from "../rounds/engine";
import { planJobs, type JobMessage, type QueuedJob, type RoundMessage, type SendJobs } from "../rounds/fanout";
import { createSupabaseRoundStore, type RoundStore } from "../rounds/store";
import { FakeZinc } from "./fake-zinc";

vi.mock("server-only", () => ({}));

const stack = await localStack({ api: true });
const local = stack?.supabase ?? null;
const BASE = "https://giftsaf.test";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!stack)("fan-out jobs (real local database, fake Zinc; ALL-125)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  const before = new Map<string, string>();
  const mail: { to: string; subject: string }[] = [];
  let today: CalendarDate;

  // Shared switches, saved and put back (another agent shares this database).
  const ON = ["round_fanout_enabled", "round_engine_enabled", "zinc_ordering_enabled", "idea_engine_enabled"];
  const SAVED = [...ON, "idea_round_runs_per_day", "idea_busy_retry_seconds", "idea_busy_retries_max"];
  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const key of SAVED) before.set(key, (await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
    today = (await pg.query("select current_date::text as d")).rows[0].d;
  });
  afterAll(async () => {
    for (const [key, value] of before) await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    for (const key of ON) await pg.query("update concierge.app_settings set value = '1' where key = $1", [key]);
    zinc = new FakeZinc((key) => users.some((u) => key === `zn_test_${u}`));
  });

  const client = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  const channel: Channel = {
    name: "email",
    send: async (email) => {
      mail.push({ to: email.to, subject: email.subject });
      return { ok: true as const, id: `msg-${mail.length}` };
    },
  };

  /** The engine wired as the job route does it, on a client of its own. */
  function engine(now: Date, generateIdeas: GenerateIdeas = async () => ({ status: "off" })): EngineDeps {
    const clock = () => 0;
    const db = client();
    const purchase: PurchaseDeps = {
      db,
      http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
      env: "test",
      webhookBaseUrl: BASE,
      now,
      settings: { feeCents: 100, marginPct: 10 },
      advanceRound: (roundId) => advanceRound(roundId, deps, { justPlaced: true }),
      sleep: async () => {},
      clock,
    };
    const deps: EngineDeps = {
      clock,
      store: createSupabaseRoundStore(db),
      notify: { store: createSupabaseNotifyStore(db), channels: [channel], baseUrl: BASE, now },
      now,
      generateIdeas,
      zinc: {
        placeRound: (id, lock, deadlineMs, opts) => placeRound(id, lock, purchase, { deadlineMs, ...opts }),
        sweep: async () => {},
        wallet: async () => ({ balanceCents: zinc.balance, autoTopUp: false }),
        lookahead: async () => ({ cents: 0, atLeast: false }),
        walletUrl: "https://zinc.test/wallet",
      },
    };
    return deps;
  }

  /** Each message to its own function, as the job route does. */
  const runJob = (message: JobMessage, deps: EngineDeps) =>
    message.kind === "round"
      ? runRoundMessage(message, { ...deps, sendJobs: async (jobs) => ({ sent: jobs.length, failed: 0 }) })
      : runBuyerMessage(message, deps);

  async function newUser(): Promise<string> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `fanout-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, auto_topup_on) values ($1, true, '5555550100', false)", [userId]);
    await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${userId}`, `zn_whsec_${randomUUID()}`, randomUUID()]);
    return userId;
  }

  type RoundOpts = { status: string; deadline: CalendarDate; nextAt: string; headsUpOn?: CalendarDate | null; idea?: boolean; fact?: boolean };
  async function newPerson(userId: string): Promise<string> {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    return person.rows[0].id;
  }
  /** A round for a person of its own (idea runs are one at a time per person), or for `on`'s. */
  async function newRound(userId: string, o: RoundOpts, on?: { personId: string; kind: string }): Promise<{ roundId: string; ideaId: string | null }> {
    const personId = on?.personId ?? (await newPerson(userId));
    if (o.fact) {
      await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'pottery', 'capture')", [
        userId,
        personId,
      ]);
    }
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, $3) returning id", [
      userId,
      personId,
      on?.kind ?? "christmas",
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, $4::date + 10, $4::date, 20000, $5, $6, $7) returning id`,
      [userId, personId, occasion.rows[0].id, o.deadline, o.status, o.nextAt, o.headsUpOn ?? null],
    );
    const roundId = round.rows[0].id as string;
    let ideaId: string | null = null;
    if (o.idea ?? true) {
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source)
         values ($1, $2, 'Stoneware mug set', 'https://shop.test/pending', 4200, 4200, 2, 3, 5, 1, 'generated') returning id`,
        [userId, roundId],
      );
      ideaId = idea.rows[0].id;
      await pg.query("update concierge.gift_ideas set product_url = 'https://shop.test/p/' || id where id = $1", [ideaId]);
    }
    return { roundId, ideaId };
  }

  /** Approved the way approveAndBuy does it (held/retry), then "crashed" before placing. */
  async function heldRound(userId: string, deadline: CalendarDate): Promise<string> {
    const { roundId, ideaId } = await newRound(userId, { status: "awaiting_approval", deadline, nextAt: "2020-01-01", headsUpOn: today });
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [roundId])).rows[0].locked_until;
    const orders = [
      {
        idea_id: ideaId,
        max_price_cents: 4520,
        fee_cents: 100,
        ship_to: "recipient",
        address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
      },
    ];
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [roundId, userId, lock, JSON.stringify(orders)]);
    await pg.query("select concierge.release_round($1, $2)", [roundId, lock]);
    return roundId;
  }

  const roundRow = async (roundId: string) =>
    (
      await pg.query(
        "select status::text as status, attention_reason, locked_until, next_action_at from concierge.gift_rounds where id = $1",
        [roundId],
      )
    ).rows[0];
  const orderRows = async (roundId: string) =>
    (await pg.query("select status, hold_reason from concierge.orders where round_id = $1 order by created_at", [roundId])).rows;
  const sends = async (roundId: string) =>
    (await pg.query("select step from concierge.round_sends where round_id = $1", [roundId])).rows.map((r) => r.step as string);

  /** A store that sees only this test's rounds and creates none, so the shared database's other rows are left alone. */
  function onlyOurs(store: RoundStore, ids: Set<string>): RoundStore {
    return {
      ...store,
      candidates: async () => [],
      dueRounds: async (now) => (await store.dueRounds(now)).filter((r) => ids.has(r.id)),
      roundsMissingOrderedEmail: async () => [],
      roundsWithRejectedAddresses: async () => [],
    };
  }

  const tomorrowNoon = () => new Date(`${addDays(today, 1)}T12:00:00Z`);

  it("runs a held round once when two jobs race for it: one advanced, one busy, one order POST (AC-5)", async () => {
    const userId = await newUser();
    const roundId = await heldRound(userId, addDays(today, 30));
    const now = tomorrowNoon();
    const message: JobMessage = { kind: "buyer", userId, roundIds: [roundId] };
    // The first POST waits, so the other job runs while the first still holds the lease.
    let open!: () => void;
    zinc.gate = new Promise<void>((resolve) => (open = resolve));
    const jobs = [runJob(message, engine(now)), runJob(message, engine(now))];
    await Promise.race([Promise.race(jobs), pause(3000)]);
    open();
    const results = await Promise.all(jobs);

    expect([...results].sort()).toEqual(["advanced", "busy"]);
    expect(zinc.posts).toHaveLength(1);
    expect(new Set(zinc.posts.map((p) => p.idem)).size).toBe(1);
    expect((await roundRow(roundId)).locked_until).toBeNull();
  }, 30_000);

  it("places one buyer's held rounds earliest deadline first, holding the one the wallet can't cover (AC-6)", async () => {
    const userId = await newUser();
    const later = await heldRound(userId, addDays(today, 30));
    const earlier = await heldRound(userId, addDays(today, 20));
    const now = tomorrowNoon();
    zinc.balance = 5000;
    zinc.onPost = () => void (zinc.balance -= 4620);
    const deps = engine(now);
    const jobs = planJobs(await onlyOurs(deps.store, new Set([earlier, later])).dueRounds(now), true, now, false);
    expect(jobs.map((j) => j.message)).toEqual([{ kind: "buyer", userId, roundIds: [earlier, later] }]);

    expect(await runJob(jobs[0]!.message, deps)).toBe("advanced");

    expect(zinc.posts).toHaveLength(1);
    expect((await orderRows(earlier))[0].status).not.toBe("held");
    expect(await roundRow(later)).toMatchObject({ status: "needs_attention", attention_reason: "funds", locked_until: null });
    expect(await orderRows(later)).toEqual([{ status: "held", hold_reason: "funds" }]);
  }, 30_000);

  it("runs a tick's 20 rounds at once: held placed, reminders sent, 5 idea runs and 5 released (AC-15)", async () => {
    // Runs dated in a random far-off year, so the daily count is this test's own: no leftover or
    // other run of this test shares the day.
    const y = 3000 + Math.floor(Math.random() * 5000);
    const now = new Date(`${y}-07-01T12:00:00Z`);
    const day = { from: `${y}-07-01T00:00:00Z`, to: `${y}-07-02T00:00:00Z` };
    const roundRuns = async () =>
      (
        await pg.query("select round_id from concierge.idea_runs where round_id is not null and started_at >= $1 and started_at < $2", [
          day.from,
          day.to,
        ])
      ).rows.map((r) => r.round_id as string);
    expect(await roundRuns()).toEqual([]);
    await pg.query("update concierge.app_settings set value = '5' where key = 'idea_round_runs_per_day'");

    const held: string[] = [];
    for (let i = 0; i < 4; i++) held.push(await heldRound(await newUser(), `${y}-08-01`));
    const buyer = await newUser();
    const reminders: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await newRound(buyer, { status: "awaiting_approval", deadline: `${y}-08-01`, nextAt: `${y}-06-30T00:00:00Z`, headsUpOn: `${y}-06-25` });
      reminders.push(r.roundId);
    }
    const ideas: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await newRound(buyer, { status: "scheduled", deadline: `${y}-08-01`, nextAt: `${y}-06-30T00:00:00Z`, idea: false, fact: true });
      ideas.push(r.roundId);
    }
    const ours = new Set([...held, ...reminders, ...ideas]);

    // The AI is never called: the fake takes a real run (start_idea_run, so the daily limit is the
    // database's), holds it 2 s as a run would, and ends it with nothing saved.
    const generateIdeas: GenerateIdeas = async (round) => {
      const store = createSupabaseIdeaStore(client());
      const started = await store.start({ userId: round.userId, personId: round.personId, roundId: round.id }, now);
      if ("refused" in started) return { status: "refused", reason: started.refused };
      await pause(2000);
      await store.finish(started.runId, "failed", 0);
      return { status: "failed" };
    };
    const results: string[] = [];
    // Every message's job starts at once, each with its own client.
    const sendJobs: SendJobs = async (jobs) => {
      results.push(...(await Promise.all(jobs.map((j) => runJob(j.message, engine(now, generateIdeas))))));
      return { sent: jobs.length, failed: 0 };
    };
    const tick = engine(now, generateIdeas);
    await runTick({ ...tick, store: onlyOurs(tick.store, ours), sendJobs });

    expect(results).toHaveLength(4 + 6 + 10);
    expect(results.filter((r) => r === "failed")).toEqual([]);
    expect(zinc.posts).toHaveLength(4);
    for (const id of held) expect((await orderRows(id))[0].status).not.toBe("held");
    for (const id of reminders) expect(await sends(id)).toContain("reminder_1");
    const ran = await roundRuns();
    expect(ran).toHaveLength(5);
    const released = ideas.filter((id) => !ran.includes(id));
    expect(released).toHaveLength(5);
    for (const id of released) {
      const row = await roundRow(id);
      expect(row.locked_until).toBeNull();
      expect(new Date(row.next_action_at).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  }, 60_000);

  describe("a round refused busy", () => {
    const set = (key: string, value: number) => pg.query("update concierge.app_settings set value = $2 where key = $1", [key, String(value)]);
    const runsOf = async (roundId: string) =>
      (await pg.query("select count(*)::int as n from concierge.idea_runs where round_id = $1", [roundId])).rows[0].n as number;
    // Rows can't show overlap: started_at is the test's clock and finished_at the real one. So the
    // fake runs leave their own marks, and everything here is one person's.
    let marks: string[];
    let active: number;
    let mostActive: number;
    let sent: QueuedJob[];
    let open: () => void;
    let held: Promise<void>;
    let log: MockInstance;
    let now: Date;

    beforeEach(async () => {
      marks = [];
      active = 0;
      mostActive = 0;
      sent = [];
      held = new Promise<void>((resolve) => (open = resolve));
      log = vi.spyOn(console, "log").mockImplementation(() => {});
      // A random far-off year, so the daily count is the test's own.
      now = new Date(`${3000 + Math.floor(Math.random() * 5000)}-07-01T12:00:00Z`);
      await set("idea_round_runs_per_day", 5);
      await set("idea_busy_retry_seconds", 300);
      await set("idea_busy_retries_max", 3);
    });
    afterEach(() => {
      open();
      log.mockRestore();
    });

    /** A real run (start_idea_run and its finish) with no AI between: it stays open until `open()`. */
    const runAt =
      (at: Date): GenerateIdeas =>
      async (round) => {
        const store = createSupabaseIdeaStore(client());
        const started = await store.start({ userId: round.userId, personId: round.personId, roundId: round.id }, at);
        if ("refused" in started) return { status: "refused", reason: started.refused };
        marks.push(`start ${round.id}`);
        mostActive = Math.max(mostActive, ++active);
        await held;
        marks.push(`finish ${round.id}`);
        active--;
        await store.finish(started.runId, "failed", 0);
        return { status: "failed" };
      };
    const capture: SendJobs = async (jobs) => {
      sent.push(...jobs);
      return { sent: jobs.length, failed: 0 };
    };
    const job = (message: RoundMessage, at = now) => runRoundMessage(message, { ...engine(at, runAt(at)), sendJobs: capture });
    const later = () => new Date(now.getTime() + 5 * 60_000);
    /** Takes what was sent so far and runs it, as the queue would 5 minutes on. */
    const runFollowUps = async () => {
      const results: string[] = [];
      for (const j of sent.splice(0)) results.push(await job(j.message as RoundMessage, later()));
      return results;
    };
    const ideasLogged = (roundId: string) =>
      log.mock.calls
        .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
        .filter((e) => e.event === "round_job" && e.round_id === roundId)
        .map((e) => `${String(e.result)} ${String(e.ideas)}`);

    async function person() {
      const userId = await newUser();
      const personId = await newPerson(userId);
      const year = now.getUTCFullYear();
      await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'pottery', 'capture')", [
        userId,
        personId,
      ]);
      const round = async (kind: string) =>
        (
          await newRound(
            userId,
            { status: "scheduled", deadline: `${year}-08-01`, nextAt: `${year}-06-30T00:00:00Z`, idea: false },
            { personId, kind },
          )
        ).roundId;
      return { userId, personId, round };
    }
    /** Both rounds' jobs at once; the one whose run started is held open until the other has ended. */
    async function bothAtOnce() {
      const p = await person();
      const ids = [await p.round("christmas"), await p.round("valentines_day")];
      const jobs = ids.map((roundId) => job({ kind: "round", roundId }));
      await Promise.race(jobs);
      open();
      const results = await Promise.all(jobs);
      const first = ids[results.indexOf("advanced")]!;
      const second = ids[results.indexOf("waiting")]!;
      expect([...results].sort()).toEqual(["advanced", "waiting"]);
      expect(ideasLogged(second)).toEqual(["waiting refused:busy"]);
      return { first, second };
    }

    it("AC-1: one person's two rounds both run the same day, the second by its follow-up", async () => {
      const { first, second } = await bothAtOnce();
      const followUps = sent.length;
      await runFollowUps();

      expect({ followUps, firstRuns: await runsOf(first), secondRuns: await runsOf(second) }).toEqual({
        followUps: 1,
        firstRuns: 1,
        secondRuns: 1,
      });
      expect(mostActive).toBe(1);
      expect(marks).toEqual([`start ${first}`, `finish ${first}`, `start ${second}`, `finish ${second}`]);
      expect(sent).toEqual([]);
    }, 30_000);

    it("AC-2: with one run a day left, the follow-up is refused and sends nothing more", async () => {
      await set("idea_round_runs_per_day", 1);
      const { first, second } = await bothAtOnce();
      expect(sent).toHaveLength(1);

      expect(await runFollowUps()).toEqual(["waiting"]);
      expect(ideasLogged(second)).toEqual(["waiting refused:busy", "waiting refused:daily_limit"]);
      expect([await runsOf(first), await runsOf(second)]).toEqual([1, 0]);
      expect(sent).toEqual([]);
    }, 30_000);

    it("AC-7: an on-demand run under way for the person puts their round off too", async () => {
      const p = await person();
      const roundId = await p.round("christmas");
      await pg.query("insert into concierge.idea_runs (user_id, person_id, started_at) values ($1, $2, $3)", [
        p.userId,
        p.personId,
        new Date(now.getTime() - 60_000),
      ]);
      expect(await job({ kind: "round", roundId })).toBe("waiting");
      expect(sent.map((j) => ({ message: j.message, delaySeconds: j.delaySeconds }))).toEqual([
        { message: { kind: "round", roundId, retry: 1 }, delaySeconds: 300 },
      ]);
      expect((await roundRow(roundId)).locked_until).toBeNull();
      expect(await runsOf(roundId)).toBe(0);
    }, 30_000);

    it("AC-3: two copies of one message make one run and no follow-up", async () => {
      const roundId = await (await person()).round("christmas");
      const jobs = [job({ kind: "round", roundId }), job({ kind: "round", roundId })];
      await Promise.race(jobs);
      open();
      expect((await Promise.all(jobs)).sort()).toEqual(["advanced", "busy"]);
      expect(await runsOf(roundId)).toBe(1);
      expect(sent).toEqual([]);
    }, 30_000);

    it("AC-9 (c): the person is deleted before the follow-up, so it does nothing", async () => {
      const p = await person();
      const roundId = await p.round("christmas");
      await pg.query("insert into concierge.idea_runs (user_id, person_id, started_at) values ($1, $2, $3)", [p.userId, p.personId, now]);
      expect(await job({ kind: "round", roundId })).toBe("waiting");
      expect(sent).toHaveLength(1);

      await pg.query("begin");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: p.userId, role: "authenticated" })]);
      await pg.query("select public.delete_person($1)", [p.personId]);
      await pg.query("commit");
      // The other run is over, so only the deletion stops this one.
      await pg.query("update concierge.idea_runs set finished_at = now() where person_id = $1", [p.personId]);

      expect(await runFollowUps()).toEqual(["busy"]);
      expect(await runsOf(roundId)).toBe(0);
      expect(sent).toEqual([]);
    }, 30_000);
  });
});
