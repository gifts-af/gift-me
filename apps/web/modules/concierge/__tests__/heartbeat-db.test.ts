// The tick's heartbeat against the real functions (E5): jobs finishing together each add their
// count, and a job that writes first keeps the tick's own clock. Skipped when the local stack
// isn't running.
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@gifts-af/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { addTickCounts, tickHeartbeat } = await import("../health/heartbeat");

const stack = await localStack({ api: true });

describe.skipIf(!stack)("the tick heartbeat (real local database)", () => {
  const local = stack?.supabase;
  const db = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  let pg: Client;
  // Days far from any real tick, so other sessions sharing the database never meet them.
  const year = 3000 + Math.floor(Math.random() * 5000);
  const days = [`${year}-01-01`, `${year}-01-02`];

  const row = async (day: string) =>
    (await pg.query("select started_at, finished_at, result, rounds_failed, fanout_failed from concierge.tick_heartbeats where day = $1", [day])).rows[0];

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.query("delete from concierge.tick_heartbeats where day = any($1::date[])", [days]);
    await pg.end();
  });

  it("two concurrent addTickCounts both land", async () => {
    const day = days[0];
    const at = new Date(`${day}T12:00:00Z`);
    await tickHeartbeat(db()).started(day, at);
    await Promise.all([addTickCounts(db(), day, at, { roundsFailed: 1 }), addTickCounts(db(), day, at, { roundsFailed: 1 })]);
    await tickHeartbeat(db()).finished(day, new Date(`${day}T12:01:00Z`), "ok", { roundsFailed: 3, fanoutFailed: 1 });
    expect(await row(day)).toMatchObject({ result: "ok", rounds_failed: 5, fanout_failed: 1 });
  });

  it("addTickCounts before start_tick keeps the test clock's started_at", async () => {
    const day = days[1];
    const at = new Date(`${day}T08:30:00Z`);
    await addTickCounts(db(), day, at, { roundsFailed: 1 });
    expect(await row(day)).toMatchObject({ started_at: at, finished_at: null, result: null, rounds_failed: 1 });
  });
});
