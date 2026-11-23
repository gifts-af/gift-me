// A run that ended because the AI credit ran out (no_credit) bought nothing, so it neither uses
// one of the round's runs nor counts as the run after a no_ideas email. Against the real store
// and the real round_idea_state (E5); skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { nextAction, type Database } from "@gifts-af/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { createSupabaseRoundStore } = await import("../rounds/store");
const { createSupabaseIdeaStore } = await import("../ideas/store");
const { view } = await import("../rounds/steps");

const stack = await localStack({ api: true });

describe.skipIf(!stack)("a no_credit run doesn't count (real local database)", () => {
  const local = stack?.supabase;
  const db = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  let pg: Client;
  const users: string[] = [];
  let engineWas: string;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    engineWas = (await pg.query("select value from concierge.app_settings where key = 'idea_engine_enabled'")).rows[0].value;
  });
  // The no_ideas emails only go while the idea engine is on; other files flip it too.
  beforeEach(async () => {
    await pg.query("update concierge.app_settings set value = '1' where key = 'idea_engine_enabled'");
  });
  afterAll(async () => {
    await pg.query("update concierge.app_settings set value = $1 where key = 'idea_engine_enabled'", [engineWas]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  /**
   * A generating round that has used all idea_round_runs_max runs, with a fact added after them
   * (the one extra run it earns), then a no_credit run. With `toldNoIdeas`, the no_ideas email
   * went after the counted runs and before the no_credit one.
   */
  async function maxedRound(o: { newerFact: boolean; toldNoIdeas: boolean }) {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `no-credit-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [userId]);
    const personId = (
      await pg.query(
        `insert into public.people (user_id, name, relationship, address_line1, city, state, zip, country)
         values ($1, 'Mary', 'friend', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
        [userId],
      )
    ).rows[0].id as string;
    const occasionId = (
      await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, personId])
    ).rows[0].id as string;
    const roundId = (
      await pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
         values ($1, $2, $3, 2030, current_date + 40, current_date + 30, 5000, 'generating', now()) returning id`,
        [userId, personId, occasionId],
      )
    ).rows[0].id as string;
    const fact = (value: string, updatedAgo: string) =>
      pg.query(
        `insert into concierge.profile_facts (user_id, person_id, category, value, source, active, updated_at)
         values ($1, $2, 'interest', $3, 'question', true, now() - $4::interval)`,
        [userId, personId, value, updatedAgo],
      );
    await fact("Loves gardening", "4 days");
    const max = Number((await pg.query("select concierge.setting_int('idea_round_runs_max') as n")).rows[0].n);
    for (let i = 0; i < max; i++) {
      await pg.query(
        `insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
         values ($1, $2, $3, now() - interval '3 days', now() - interval '3 days', 'none')`,
        [userId, personId, roundId],
      );
    }
    if (o.newerFact) await fact("Reads mysteries", "2 days");
    if (o.toldNoIdeas) {
      await pg.query("insert into concierge.round_sends (round_id, user_id, step, created_at) values ($1, $2, 'no_ideas', now() - interval '1 day')", [
        roundId,
        userId,
      ]);
    }
    await pg.query(
      `insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
       values ($1, $2, $3, now() - interval '1 hour', now() - interval '1 hour', 'no_credit')`,
      [userId, personId, roundId],
    );
    return { userId, personId, roundId };
  }

  /** What the engine would do with the round today, from the real store's context. */
  async function plan(r: { userId: string; personId: string; roundId: string }) {
    const store = createSupabaseRoundStore(db());
    const ctx = await store.roundContext(r.roundId);
    const sent = await store.sentSteps(r.roundId);
    const { schedule } = await createSupabaseIdeaStore(db()).settings();
    const today = (await pg.query("select current_date::text as d")).rows[0].d as string;
    const round = (await pg.query("select ship_by_deadline::text as d from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].d as string;
    const v = view(
      {
        id: r.roundId,
        userId: r.userId,
        personId: r.personId,
        status: "generating",
        shipByDeadline: round,
        headsUpOn: null,
        late: false,
        attempts: 0,
        lockedUntil: new Date(),
        attentionReason: null,
        holdCount: 0,
        seenBalanceCents: null,
        emailedBalanceCents: null,
      },
      ctx,
      sent,
    );
    return { ctx, next: nextAction(v, today, schedule) };
  }

  it("roundContext has ideaRunsLeft true and ranSinceNoIdeas false, and nextAction doesn't send no_ideas", async () => {
    const { ctx, next } = await plan(await maxedRound({ newerFact: true, toldNoIdeas: false }));
    expect(ctx).toMatchObject({ ideaRunsLeft: true, ranSinceNoIdeas: false });
    expect(next).toEqual({ do: "generate" });
  });

  it("with no_ideas already sent: ranSinceNoIdeas stays false and no no_ideas_again", async () => {
    const { ctx, next } = await plan(await maxedRound({ newerFact: true, toldNoIdeas: true }));
    expect(ctx).toMatchObject({ ideaRunsLeft: true, ranSinceNoIdeas: false });
    expect(next).toEqual({ do: "generate" });
  });

  it("with the runs spent and no_ideas sent, a no_credit run doesn't bring no_ideas_again", async () => {
    const { ctx, next } = await plan(await maxedRound({ newerFact: false, toldNoIdeas: true }));
    expect(ctx).toMatchObject({ ideaRunsLeft: false, ranSinceNoIdeas: false });
    expect(next).toMatchObject({ do: "wait" });
  });
});
