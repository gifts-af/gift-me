// People are free, and the concierge spends only on accounts with paid features. The real tick,
// candidates query and idea-run rules against the local database (E5); only the AI and the email
// channel are faked. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@gifts-af/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { costRecorder } from "../costs/record";
import type { IdeaOutcome } from "../ideas/run";
import { createSupabaseIdeaStore } from "../ideas/store";
import type { Channel } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { runTick } from "../rounds/engine";
import { createSupabaseRoundStore, type RoundStore } from "../rounds/store";
import { captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

const stack = await localStack({ api: true });

captureLog();

describe.skipIf(!stack)("a free account at the daily tick (real local database)", () => {
  const local = stack?.supabase;
  const client = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let pg: Client;
  const users: string[] = [];
  const before = new Map<string, string>();
  // The idea limits leave room for these two accounts, whatever else ran today.
  const SETTINGS = {
    round_engine_enabled: 1,
    round_fanout_enabled: 0,
    idea_rounds_per_tick: 5,
    idea_round_runs_per_day: 100_000,
    cost_tracking_enabled: 1,
  };
  const set = (key: string, value: string) => pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const [key, value] of Object.entries(SETTINGS)) {
      before.set(key, (await pg.query("select value::text as value from concierge.app_settings where key = $1", [key])).rows[0].value);
      await set(key, String(value));
    }
  });
  afterAll(async () => {
    for (const [key, value] of before) await set(key, value);
    // Before the users: deleting them clears these rows' links.
    await pg.query("delete from concierge.cost_events where idea_run_id in (select id from concierge.idea_runs where user_id = any($1::uuid[]))", [users]);
    await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  /** Someone with a person the concierge could buy for: an address, something to go on, and a birthday 30 days off. */
  async function newUser(): Promise<string> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `free-account-${userId}@example.test`],
    );
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Odalys', 'friend', 'Odalys', 'Rivera', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    const personId = person.rows[0].id as string;
    await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'pottery', 'question')", [
      userId,
      personId,
    ]);
    const birthday = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pg.query("insert into concierge.occasions (user_id, person_id, kind, month, day) values ($1, $2, 'birthday', $3, $4)", [
      userId,
      personId,
      birthday.getUTCMonth() + 1,
      birthday.getUTCDate(),
    ]);
    return userId;
  }
  const pay = (userId: string) =>
    pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true) on conflict (user_id) do update set paid_features = true", [userId]);

  /** The real store and queries, showing only these users' rows, since the tick reads everyone's. */
  function onlyOurs(store: RoundStore): RoundStore {
    const ours = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => users.includes(r.userId));
    return {
      ...store,
      candidates: async (today) => ours(await store.candidates(today)),
      claimDue: async (now) => {
        const claimed = [];
        for (const due of ours(await store.dueRounds(now))) claimed.push(await store.claim(due.id, now));
        return claimed.filter((r) => r !== null);
      },
      claimDueMoney: async () => [],
      roundsMissingOrderedEmail: async () => [],
      roundsWithRejectedAddresses: async () => [],
      deliveredRoundsUntold: async () => [],
    };
  }

  /** One tick. Its idea runs are real (start, cost, finish) but for the AI: each saves one gift. */
  async function tick() {
    const db = client();
    const now = new Date();
    const channel: Channel = { name: "email", send: async () => ({ ok: true as const, id: randomUUID() }) };
    const generateIdeas = async (round: { id: string; userId: string; personId: string }): Promise<IdeaOutcome> => {
      const ideas = createSupabaseIdeaStore(db);
      const started = await ideas.start({ userId: round.userId, personId: round.personId, roundId: round.id }, now);
      if ("refused" in started) return { status: "refused", reason: started.refused };
      await costRecorder(() => db)({ userId: round.userId, kind: "ai_ideas", cents: 1, estimated: false, ideaRunId: started.runId });
      await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank)
         values ($1, $2, $3, 'Mug set', 'https://shop.test/p', 3000, 3500, 1, 2, 4, 1)`,
        [round.userId, round.id, round.personId],
      );
      await ideas.finish(started.runId, "saved", 1);
      return { status: "saved", count: 1 };
    };
    return runTick({
      store: onlyOurs(createSupabaseRoundStore(db)),
      notify: { store: createSupabaseNotifyStore(db), channels: [channel], baseUrl: "https://giftsaf.test", now },
      now,
      generateIdeas,
      zinc: null,
    });
  }

  /** What the concierge did for someone. */
  async function made(userId: string) {
    const count = async (rows: string) => (await pg.query(`select count(*)::int as n from ${rows}`, [userId])).rows[0].n as number;
    return {
      rounds: await count("concierge.gift_rounds where user_id = $1"),
      ideaRuns: await count("concierge.idea_runs where user_id = $1"),
      costEvents: await count("concierge.cost_events c join concierge.idea_runs r on r.id = c.idea_run_id where r.user_id = $1"),
      notifications: await count("concierge.notifications where user_id = $1"),
    };
  }

  it("AC-20: the paid account's person gets a round; the free one's gets nothing, until it's paid", async () => {
    const paid = await newUser();
    const free = await newUser();
    await pay(paid);
    const everything = { rounds: 1, ideaRuns: 1, costEvents: 1, notifications: 1 };

    expect(await tick()).toMatchObject({ enabled: true, failed: 0 });
    expect(await made(paid)).toEqual(everything);
    expect(await made(free)).toEqual({ rounds: 0, ideaRuns: 0, costEvents: 0, notifications: 0 });

    // The free account lacked only paid features.
    await pay(free);
    expect(await tick()).toMatchObject({ enabled: true, failed: 0 });
    expect(await made(free)).toEqual(everything);
    expect(await made(paid)).toEqual(everything);
  }, 30_000);
});
