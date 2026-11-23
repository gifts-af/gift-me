// Fan-out jobs (ALL-125) against the real local database (E5): the round lease, placing and the
// idea runs' daily limit are the database's own behaviour. Only Zinc, email and the AI are faked
// (no paid calls). Every job builds its own Supabase client, so the database sees separate,
// concurrent requests. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { addDays, type CalendarDate, type Database } from "@gifts-af/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { Channel } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { createSupabaseIdeaStore } from "../ideas/store";
import { placeRound } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import { advanceRound, runRoundJob, runTick, type EngineDeps, type GenerateIdeas } from "../rounds/engine";
import { planJobs, type JobMessage, type SendJobs } from "../rounds/fanout";
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
  const SAVED = [...ON, "idea_round_runs_per_day"];
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
  /** A round for a person of its own (idea runs are one at a time per person). */
  async function newRound(userId: string, o: RoundOpts): Promise<{ roundId: string; ideaId: string | null }> {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    const personId = person.rows[0].id as string;
    if (o.fact) {
      await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'pottery', 'capture')", [
        userId,
        personId,
      ]);
    }
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, personId]);
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
    const jobs = [runRoundJob(message, engine(now)), runRoundJob(message, engine(now))];
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

    expect(await runRoundJob(jobs[0]!.message, deps)).toBe("advanced");

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
      results.push(...(await Promise.all(jobs.map((j) => runRoundJob(j.message, engine(now, generateIdeas))))));
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
});
