// A birthday moving at the same moment as an approval or an idea run, on the real local database
// with two connections (E5): whoever takes the round's lock first wins, and the other sees it.
// Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, parseDate, roundToCreate, type CalendarDate, type Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { createSupabaseRoundStore } = await import("../rounds/store");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("a date moved at the same moment (real local database)", () => {
  let a: Client;
  let b: Client;
  let watch: Client;
  const users: string[] = [];

  beforeAll(async () => {
    [a, b, watch] = await Promise.all(
      [0, 1, 2].map(async () => {
        const c = new Client({ connectionString: LOCAL_DB });
        await c.connect();
        return c;
      }),
    );
    await watch.query("insert into concierge.app_settings (key, value) values ('moved_dates_close_rounds', '1') on conflict (key) do update set value = '1'");
  });
  afterAll(async () => {
    if (users.length) await watch.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await Promise.all([a, b, watch].map((c) => c.end()));
  });

  let user: string;
  let person: string;
  let occasion: string;
  let round: string;
  let idea: string;
  let lock: string;
  beforeEach(async () => {
    user = randomUUID();
    users.push(user);
    const one = async (sql: string, values: unknown[]) => (await watch.query(sql, values)).rows[0].id as string;
    await watch.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [user, `moved-${user}@example.com`],
    );
    await watch.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [user]);
    person = await one("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [user]);
    occasion = await one("insert into concierge.occasions (user_id, person_id, kind, month, day) values ($1, $2, 'birthday', 12, 28) returning id", [user, person]);
    round = await one(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, locked_until)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(), now() + interval '10 minutes') returning id`,
      [user, person, occasion],
    );
    lock = (await watch.query("select locked_until::text as l from concierge.gift_rounds where id = $1", [round])).rows[0].l;
    idea = await one(
      "insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank) values ($1, $2, $3, 'Vase', 4000, 4500, 1) returning id",
      [user, round, person],
    );
  });

  const approve = (c: Client) =>
    c.query("select * from concierge.approve_round($1, $2, $3::timestamptz, $4::jsonb)", [
      round,
      user,
      lock,
      JSON.stringify([
        {
          idea_id: idea,
          max_price_cents: 4500,
          fee_cents: 100,
          ship_to: "recipient",
          address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
        },
      ]),
    ]);
  const move = (c: Client) => c.query("update concierge.occasions set month = 1, day = 5 where id = $1", [occasion]);
  const startRun = (c: Client) => c.query("select * from concierge.start_idea_run($1, $2, $3, now())", [user, person, round]);
  const saveIdeas = (c: Client, run: string) =>
    c.query("select concierge.save_ideas($1, $2::jsonb) as n", [run, JSON.stringify([{ title: "Mug", price_cents: 100, est_total_cents: 100, rank: 1 }])]);
  const roundRow = async () => (await watch.query("select status::text, occasion_year from concierge.gift_rounds where id = $1", [round])).rows[0];
  const orders = async () => (await watch.query("select count(*)::int as n from concierge.orders where round_id = $1", [round])).rows[0].n as number;

  /** `first` in an open transaction on a, then `second` on b, which must wait; a commits, b's result comes back. */
  async function race<T>(first: () => Promise<unknown>, second: () => Promise<T>): Promise<PromiseSettledResult<T>> {
    const pid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid as number;
    await a.query("begin");
    try {
      await first();
      const pending = Promise.allSettled([second()]);
      await expect
        .poll(async () => (await watch.query("select wait_event_type from pg_stat_activity where pid = $1", [pid])).rows[0].wait_event_type, { timeout: 5000 })
        .toBe("Lock");
      await a.query("commit");
      return (await pending)[0];
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
  }

  it("AC-8: an approval that got there first keeps its round and order", async () => {
    expect((await race(() => approve(a), () => move(b))).status).toBe("fulfilled");
    expect(await roundRow()).toMatchObject({ occasion_year: 2030 });
    expect((await roundRow()).status).not.toBe("skipped");
    expect(await orders()).toBe(1);
  });

  it("AC-8: a move that got there first refuses the approval, with no order", async () => {
    expect((await race(() => move(a), () => approve(b))).status).toBe("rejected");
    expect(await roundRow()).toEqual({ status: "skipped", occasion_year: null });
    expect(await orders()).toBe(0);
  });

  it("AC-9: a run that started first makes the move wait, and then can't save", async () => {
    await watch.query("delete from concierge.gift_ideas where round_id = $1", [round]);
    let run = "";
    const moved = await race(
      async () => {
        run = (await startRun(a)).rows[0].run_id;
      },
      () => move(b),
    );
    expect(moved.status).toBe("fulfilled");
    expect(run).not.toBeNull();
    expect((await saveIdeas(a, run)).rows[0].n).toBe(-1);
    expect((await watch.query("select count(*)::int as n from concierge.gift_ideas where round_id = $1", [round])).rows[0].n).toBe(0);
  });

  it("AC-9: a move that got there first starts no run", async () => {
    await watch.query("delete from concierge.gift_ideas where round_id = $1", [round]);
    const started = await race(() => move(a), () => startRun(b));
    expect(started.status === "fulfilled" && started.value.rows[0]).toEqual({ run_id: null, refusal: "closed" });
  });

  it("AC-9: ideas saved first stay on the round the move then ends", async () => {
    await watch.query("delete from concierge.gift_ideas where round_id = $1", [round]);
    const run = (await startRun(a)).rows[0].run_id as string;
    expect((await race(() => saveIdeas(a, run), () => move(b))).status).toBe("fulfilled");
    expect(await roundRow()).toEqual({ status: "skipped", occasion_year: null });
  });

  // ─── the tick after a move, through the engine's own store ────────────────

  const store = () => createSupabaseRoundStore(createClient<Database>(stack!.supabase!.url, stack!.supabase!.serviceRoleKey, { auth: { persistSession: false } }));
  const today: CalendarDate = new Date().toISOString().slice(0, 10);
  /** What the tick's round creation does for this buyer; returns the new round's date, or null. */
  async function createDue(): Promise<CalendarDate | null> {
    const st = store();
    const mine = (await st.candidates(today)).filter((c) => c.userId === user);
    expect(mine).toHaveLength(1);
    const plan = roundToCreate(mine[0].rule, today, await st.scheduleSettings());
    if (!plan) return null;
    const inserted = await st.insertRound({ userId: user, personId: person, occasionId: occasion, ...plan, budgetCents: null, nextActionAt: new Date() });
    return inserted ? plan.occasionDate : null;
  }
  async function moveTo(date: CalendarDate) {
    const { month, day } = parseDate(date);
    await watch.query("update concierge.occasions set month = $2, day = $3 where id = $1", [occasion, month, day]);
  }
  async function startOver(date: CalendarDate) {
    await watch.query("delete from concierge.gift_rounds where occasion_id = $1", [occasion]);
    await moveTo(date);
    expect(await createDue()).toBe(date);
  }

  it("AC-3: the next tick starts a round on the new date, and only one", async () => {
    await startOver(addDays(today, 30));
    const was = (await watch.query("select id from concierge.gift_rounds where occasion_id = $1", [occasion])).rows[0].id as string;
    expect(await store().endedByMove(was)).toBe(false);
    await moveTo(addDays(today, 27));
    expect(await store().endedByMove(was)).toBe(true);
    expect(await createDue()).toBe(addDays(today, 27));
    expect(await createDue()).toBeNull();
  });

  it("AC-4: nothing starts while the new date is far off", async () => {
    await startOver(addDays(today, 30));
    await moveTo(addDays(today, 200));
    expect(await createDue()).toBeNull();
    expect((await watch.query("select count(*)::int as n from concierge.gift_rounds where occasion_id = $1 and status <> 'skipped'", [occasion])).rows[0].n).toBe(0);
  });

  it("AC-9: a claimed round's lease is gone after a move", async () => {
    await startOver(addDays(today, 30));
    const id = (await watch.query("select id from concierge.gift_rounds where occasion_id = $1", [occasion])).rows[0].id as string;
    const claimed = await store().claim(id, new Date());
    expect(await store().holdsLease(id, claimed!.lockedUntil)).toBe(true);
    await moveTo(addDays(today, 27));
    expect(await store().holdsLease(id, claimed!.lockedUntil)).toBe(false);
    expect(await store().finish(id, claimed!.lockedUntil, { status: "awaiting_approval", nextActionAt: null })).toBe(false);
  });
});
