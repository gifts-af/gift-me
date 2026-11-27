// Adding a fact from "What we know" against the real local database and its row-level security
// (E5): it saves an active "you told us" fact, and counts as a new fact, so a round whose last
// search found nothing is searched again (changed_at, T68). Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "@/test/local-db";
import { addFact } from "../profile/profile";

vi.spyOn(console, "log").mockImplementation(() => {});

const stack = await localStack({ api: true });

describe.skipIf(!stack)("addFact (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  const users: string[] = [];
  let pg: Client;
  let runsMax: string;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    runsMax = (await pg.query("select value::text as v from concierge.app_settings where key = 'idea_round_runs_max'")).rows[0].v;
    await pg.query("update concierge.app_settings set value = '2' where key = 'idea_round_runs_max'");
  });
  afterAll(async () => {
    await pg.query("update concierge.app_settings set value = $1 where key = 'idea_round_runs_max'", [runsMax]);
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  const one = async (sql: string, args: unknown[]) => (await pg.query(sql, args)).rows[0].id as string;

  async function newUser() {
    const email = `add-fact-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    const personId = await one("insert into public.people (user_id, name, relationship) values ($1, 'Mom', 'mother') returning id", [data.user.id]);
    return { id: data.user.id, db, personId };
  }

  /** A round whose one search, a minute ago, found nothing, with an older fact. */
  async function waitingRound(userId: string, personId: string) {
    await pg.query(
      "insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at) values ($1, $2, 'interest', 'Tea', 'question', now() - interval '5 days')",
      [userId, personId],
    );
    const occasionId = await one("insert into concierge.occasions (user_id, person_id, kind, month, day) values ($1, $2, 'birthday', 3, 14) returning id", [userId, personId]);
    const roundId = await one(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 44, current_date + 30, 5000, 'awaiting_approval', now() + interval '1 day') returning id`,
      [userId, personId, occasionId],
    );
    await pg.query(
      "insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome) values ($1, $2, $3, now() - interval '1 minute', now() - interval '1 minute', 'none')",
      [userId, personId, roundId],
    );
    return roundId;
  }

  const runsLeft = async (roundId: string) =>
    (await pg.query("select runs_left from concierge.round_idea_state($1)", [roundId])).rows[0].runs_left as boolean;
  const facts = async (personId: string) =>
    (await pg.query("select category, value, source, confirmed, active from concierge.profile_facts where person_id = $1 order by created_at", [personId])).rows;

  it("saves an active, confirmed fact the buyer told us, and it wakes a round whose search found nothing", async () => {
    const u = await newUser();
    const roundId = await waitingRound(u.id, u.personId);
    expect(await runsLeft(roundId)).toBe(false);

    expect(await addFact(u.db, u.personId, { category: "interest", value: "pottery" })).toEqual({ ok: true });

    expect(await facts(u.personId)).toEqual([
      { category: "interest", value: "Tea", source: "question", confirmed: false, active: true },
      { category: "interest", value: "pottery", source: "note", confirmed: true, active: true },
    ]);
    expect(await runsLeft(roundId)).toBe(true);
  });

  it("turns a matching turned-off fact back on, which counts as new too", async () => {
    const u = await newUser();
    const roundId = await waitingRound(u.id, u.personId);
    await pg.query("update concierge.profile_facts set active = false where person_id = $1", [u.personId]);
    await pg.query("update concierge.profile_facts set changed_at = now() - interval '5 days' where person_id = $1", [u.personId]);

    expect(await addFact(u.db, u.personId, { category: "interest", value: "tea" })).toEqual({ ok: true });

    expect(await facts(u.personId)).toEqual([{ category: "interest", value: "Tea", source: "question", confirmed: true, active: true }]);
    expect(await runsLeft(roundId)).toBe(true);
  });

  it("says so when it's already there, and changes nothing", async () => {
    const u = await newUser();
    const roundId = await waitingRound(u.id, u.personId);
    const result = await addFact(u.db, u.personId, { category: "interest", value: "tea" });
    expect(result).toEqual({ ok: false, error: "That's already on their profile." });
    expect(await facts(u.personId)).toHaveLength(1);
    expect(await runsLeft(roundId)).toBe(false);
  });

  it("refuses someone else's person, and a deleted one", async () => {
    const a = await newUser();
    const b = await newUser();
    expect(await addFact(a.db, b.personId, { category: "interest", value: "pottery" })).toEqual({
      ok: false,
      error: "This person is no longer on your list.",
    });
    await pg.query("update public.people set deleted_at = now() where id = $1", [a.personId]);
    expect((await addFact(a.db, a.personId, { category: "interest", value: "pottery" })).ok).toBe(false);
    expect(await facts(a.personId)).toEqual([]);
    expect(await facts(b.personId)).toEqual([]);
  });
});
