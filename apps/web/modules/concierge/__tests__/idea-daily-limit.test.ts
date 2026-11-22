// Ten real connections race start_idea_run for round runs when only one place
// is left in the day (ALL-125, AC-9). The daily limit is counted under its own
// advisory lock, so exactly one start wins. Skipped when the local database
// isn't running.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";

const dbUp = (await localStack({ api: false })) !== null;

const NOW = "2031-06-16T12:00:00Z";

describe.skipIf(!dbUp)("the daily limit on round idea runs (ten connections, local Supabase)", () => {
  let admin: Client;
  const users: string[] = [];
  let limitBefore: string | null = null;

  beforeAll(async () => {
    admin = new Client({ connectionString: LOCAL_DB });
    await admin.connect();
    const { rows } = await admin.query("select value::text as v from concierge.app_settings where key = 'idea_round_runs_per_day'");
    limitBefore = rows[0]?.v ?? null;
    await admin.query(
      `insert into concierge.app_settings (key, value) values ('idea_round_runs_per_day', '5')
       on conflict (key) do update set value = '5'`,
    );
  });

  afterAll(async () => {
    if (users.length) await admin.query("delete from auth.users where id = any($1::uuid[])", [users]);
    if (limitBefore !== null) {
      await admin.query("update concierge.app_settings set value = $1::jsonb where key = 'idea_round_runs_per_day'", [limitBefore]);
    }
    await admin.end();
  });

  /** A paid person with one open round, and the ids to start a run for it. */
  async function roundFor(): Promise<{ userId: string; personId: string; roundId: string }> {
    const userId = randomUUID();
    users.push(userId);
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `daily-${userId}@example.com`],
    );
    await admin.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [userId]);
    const person = await admin.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [userId]);
    const personId: string = person.rows[0].id;
    const occasion = await admin.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, personId]);
    const round = await admin.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
       values ($1, $2, $3, 2031, '2031-12-25', '2031-12-15', 5000) returning id`,
      [userId, personId, occasion.rows[0].id],
    );
    return { userId, personId, roundId: round.rows[0].id };
  }

  it("lets exactly one of ten simultaneous round runs start when one place is left", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await roundFor();
      await admin.query(
        "insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values ($1, $2, $3, '2031-06-16T08:00:00Z')",
        [r.userId, r.personId, r.roundId],
      );
    }
    const racers = await Promise.all(Array.from({ length: 10 }, () => roundFor()));
    const clients = await Promise.all(
      racers.map(async () => {
        const c = new Client({ connectionString: LOCAL_DB });
        await c.connect();
        await c.query("set statement_timeout = 10000");
        await c.query("set role service_role");
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((c, i) =>
          c.query("select run_id, refusal from concierge.start_idea_run($1, $2, $3, $4)", [
            racers[i].userId,
            racers[i].personId,
            racers[i].roundId,
            NOW,
          ]),
        ),
      );
      const rows = results.map((r) => r.rows[0] as { run_id: string | null; refusal: string | null });
      expect(rows.filter((r) => r.run_id !== null)).toHaveLength(1);
      expect(rows.filter((r) => r.refusal === "daily_limit")).toHaveLength(9);
      const { rows: count } = await admin.query(
        `select count(*)::int as n from concierge.idea_runs
          where round_id is not null and user_id = any($1::uuid[])
            and started_at >= '2031-06-16T00:00:00Z' and started_at < '2031-06-17T00:00:00Z'`,
        [users],
      );
      expect(count[0].n).toBe(5);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
