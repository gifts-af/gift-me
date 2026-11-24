// The cost recorder on the real local database (E5): a recorded cost lands in
// cost_events through the service-role client, and a flagged account's is marked left out.
// Rows are tied to a test user's idea run; the test deletes them, and db:clean removes any a
// crashed run leaves. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { costRecorder } = await import("../costs/record");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("costRecorder (local Supabase)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  let pg: Client;
  const users: string[] = [];
  const runs: string[] = [];

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });

  afterAll(async () => {
    if (runs.length) await pg.query("delete from concierge.cost_events where idea_run_id = any($1::uuid[])", [runs]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  async function runFor(excluded: boolean): Promise<{ userId: string; runId: string }> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `cost-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, costs_excluded) values ($1, $2)", [userId, excluded]);
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [userId]);
    const run = await pg.query("insert into concierge.idea_runs (user_id, person_id) values ($1, $2) returning id", [userId, person.rows[0].id]);
    runs.push(run.rows[0].id);
    return { userId, runId: run.rows[0].id };
  }

  const rows = async (runId: string) =>
    (await pg.query("select kind, cents::float8 as cents, estimated, excluded from concierge.cost_events where idea_run_id = $1", [runId])).rows;

  it("writes the cost, with fractions kept, reading the timeout from the setting", async () => {
    const { userId, runId } = await runFor(false);
    await costRecorder(() => admin!)({ userId, kind: "ai_ideas", cents: 12.3456, estimated: true, ideaRunId: runId });
    expect(await rows(runId)).toEqual([{ kind: "ai_ideas", cents: 12.3456, estimated: true, excluded: false }]);
  });

  it("marks a flagged account's cost as left out", async () => {
    const { userId, runId } = await runFor(true);
    await costRecorder(() => admin!, 3000)({ userId, kind: "lookup_ideas", cents: 4, estimated: true, ideaRunId: runId });
    expect(await rows(runId)).toEqual([{ kind: "lookup_ideas", cents: 4, estimated: true, excluded: true }]);
  });
});
