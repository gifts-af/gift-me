// @vitest-environment node
// Two real connections to local Supabase race the money-path functions
// against each other (ALL-32 Task 2, AC-18, AC-24, AC-25, review focus 4).
// Every function locks the round row first, so one waits for the other and
// nothing that was sent can be cancelled. A 5 s statement timeout turns a
// deadlock or a lost wake-up into a failure. Skipped when the local
// database isn't running (the unit-test CI job has none).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";



const dbUp = (await localStack({ api: false })) !== null;

async function connect(role: "service_role" | "postgres" = "service_role"): Promise<Client> {
  const c = new Client({ connectionString: LOCAL_DB });
  await c.connect();
  await c.query("set statement_timeout = 5000");
  if (role === "service_role") await c.query("set role service_role");
  return c;
}

/** Reports whether a query has finished, so a test can show it is waiting on a lock. */
function track<T>(p: Promise<T>): { promise: Promise<T>; done: () => boolean } {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  return { promise: p, done: () => settled };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Fixture = { userId: string; personId: string; roundId: string; orderId: string; lock: string };

describe.skipIf(!dbUp)("placing races (two connections, local Supabase)", () => {
  let admin: Client;
  const users: string[] = [];
  let killSwitchBefore: string | null = null;

  beforeAll(async () => {
    admin = await connect("postgres");
    const { rows } = await admin.query("select value::text as v from concierge.app_settings where key = 'zinc_ordering_enabled'");
    killSwitchBefore = rows[0]?.v ?? null;
    await admin.query(
      `insert into concierge.app_settings (key, value) values ('zinc_ordering_enabled', '1')
       on conflict (key) do update set value = '1'`,
    );
  });

  afterAll(async () => {
    if (users.length) await admin.query("delete from auth.users where id = any($1::uuid[])", [users]);
    if (killSwitchBefore !== null) {
      await admin.query("update concierge.app_settings set value = $1::jsonb where key = 'zinc_ordering_enabled'", [killSwitchBefore]);
    }
    await admin.end();
  });

  /** A connected, paid user with one round holding one order, and the round's lease. */
  async function fixture(orderStatus: "held" | "placing", holdReason: string | null = "retry"): Promise<Fixture> {
    const userId = randomUUID();
    users.push(userId);
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `race-${userId}@example.com`],
    );
    await admin.query(
      `insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at, zinc_api_key_secret_id, zinc_env)
       values ($1, true, '5555550100', now(), gen_random_uuid(), 'test')`,
      [userId],
    );
    const person = await admin.query(
      "insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id",
      [userId],
    );
    const personId: string = person.rows[0].id;
    const occasion = await admin.query(
      "insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id",
      [userId, personId],
    );
    const round = await admin.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                          budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000,
               $4::concierge.round_status, now())
       returning id`,
      [userId, personId, occasion.rows[0].id, orderStatus === "held" ? "needs_attention" : "ordered"],
    );
    const roundId: string = round.rows[0].id;
    const idea = await admin.query(
      `insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
       values ($1, $2, 'Mug', 4000, 4500, 1) returning id`,
      [userId, roundId],
    );
    const order = await admin.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                     ship_to, ship_city, ship_state)
       values ($1, $2, $3, 'zinc_wallet', 4500, 100, $4, $5, 'recipient', 'Dayton', 'OH') returning id`,
      [userId, roundId, idea.rows[0].id, orderStatus, orderStatus === "held" ? holdReason : null],
    );
    const orderId: string = order.rows[0].id;
    await admin.query(
      `insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                              city, state, zip, country)
       values ($1, $2, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US')`,
      [orderId, userId],
    );
    await admin.query("select concierge.reconcile_round($1)", [roundId]);
    // The lease travels as text: a JS Date would drop the microseconds.
    const lease = await admin.query(
      "update concierge.gift_rounds set locked_until = now() + interval '10 minutes' where id = $1 returning locked_until::text as lock",
      [roundId],
    );
    return { userId, personId, roundId, orderId, lock: lease.rows[0].lock };
  }

  async function roundState(roundId: string): Promise<string> {
    const { rows } = await admin.query(
      "select status::text || '/' || coalesce(attention_reason, '-') as s from concierge.gift_rounds where id = $1",
      [roundId],
    );
    return rows[0].s;
  }

  async function orderStatus(orderId: string): Promise<string> {
    const { rows } = await admin.query("select status from concierge.orders where id = $1", [orderId]);
    return rows[0].status;
  }

  const beginPlacing = (c: Client, f: Fixture) =>
    c.query("select * from concierge.begin_placing($1, $2::timestamptz, current_date, $3::jsonb)", [
      f.roundId,
      f.lock,
      JSON.stringify([{ id: f.orderId, max_price_cents: 4500 }]),
    ]);

  /** A runs `first` in an open transaction; B's `second` must wait for A's commit. */
  async function race<T>(
    first: (a: Client) => Promise<unknown>,
    second: (b: Client) => Promise<T>,
  ): Promise<T> {
    const a = await connect();
    const b = await connect();
    try {
      await a.query("begin");
      await first(a);
      const waiting = track(second(b));
      await pause(300);
      expect(waiting.done(), "the second call waits for the round lock").toBe(false);
      await a.query("commit");
      return await waiting.promise;
    } finally {
      await a.end();
      await b.end();
    }
  }

  it("begin_placing first: a cancel waits, then leaves the placing order alone (ordered)", async () => {
    const f = await fixture("held");
    const result = await race(
      async (a) => expect((await beginPlacing(a, f)).rowCount).toBe(1),
      (b) => b.query("select concierge.cancel_held($1, 'cancel') as s", [f.roundId]),
    );
    expect(result.rows[0].s).toBe("ordered");
    expect(await orderStatus(f.orderId)).toBe("placing");
  });

  it("cancel first: begin_placing waits, then places nothing (skipped)", async () => {
    const f = await fixture("held");
    const result = await race(
      async (b) => expect((await b.query("select concierge.cancel_held($1, 'cancel') as s", [f.roundId])).rows[0].s).toBe("skipped"),
      (a) => beginPlacing(a, f),
    );
    expect(result.rowCount).toBe(0);
    expect(await orderStatus(f.orderId)).toBe("cancelled");
    expect(await roundState(f.roundId)).toBe("skipped/-");
  });

  it("begin_placing first: disconnect waits, then refuses ('placing')", async () => {
    const f = await fixture("held");
    const result = await race(
      async (a) => expect((await beginPlacing(a, f)).rowCount).toBe(1),
      (b) => b.query("select concierge.zinc_forget($1) as r", [f.userId]),
    );
    expect(result.rows[0].r).toBe("placing");
    expect(await orderStatus(f.orderId)).toBe("placing");
  });

  it("disconnect first: begin_placing waits, then holds the order for setup", async () => {
    const f = await fixture("held");
    const result = await race(
      async (b) => expect((await b.query("select concierge.zinc_forget($1) as r", [f.userId])).rows[0].r).toBe("ok"),
      (a) => beginPlacing(a, f),
    );
    expect(result.rowCount).toBe(0);
    expect(await orderStatus(f.orderId)).toBe("held");
    expect(await roundState(f.roundId)).toBe("needs_attention/setup");
  });

  it("record_outcomes first: a webhook's settle_order waits, then places the order", async () => {
    const f = await fixture("placing");
    const result = await race(
      (a) =>
        a.query("select concierge.record_outcomes($1, $2::jsonb)", [
          f.roundId,
          JSON.stringify([{ order_id: f.orderId, outcome: "sent", provider_order_id: "zn_race" }]),
        ]),
      (b) => b.query("select concierge.settle_order($1, $2, 'placed', null, null) as s", [f.userId, f.orderId]),
    );
    expect(result.rows[0].s).toBe("ordered");
    const { rows } = await admin.query("select status, provider_order_id from concierge.orders where id = $1", [f.orderId]);
    expect(rows[0]).toEqual({ status: "placed", provider_order_id: "zn_race" });
  });

  it("settle_order first: record_outcomes waits, then leaves the settled order alone", async () => {
    const f = await fixture("placing");
    const result = await race(
      (b) => b.query("select concierge.settle_order($1, $2, 'failed', 'out_of_stock', null)", [f.userId, f.orderId]),
      (a) =>
        a.query("select concierge.record_outcomes($1, $2::jsonb) as s", [
          f.roundId,
          JSON.stringify([{ order_id: f.orderId, outcome: "insufficient", available_cents: 0 }]),
        ]),
    );
    expect(result.rows[0].s).toBe("needs_attention");
    expect(await orderStatus(f.orderId)).toBe("failed");
    expect(await roundState(f.roundId)).toBe("needs_attention/out_of_stock");
  });

  // Review focus 4, through the real path: delete_person → trigger → skip_open_rounds.
  const deletePerson = async (c: Client, f: Fixture) => {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.userId, role: "authenticated" })]);
    await c.query("set local role authenticated");
    await c.query("select public.delete_person($1)", [f.personId]);
  };

  it("begin_placing first: deleting the person waits, and the sent order stays (ordered)", async () => {
    const f = await fixture("held");
    await race(
      async (a) => expect((await beginPlacing(a, f)).rowCount).toBe(1),
      async (b) => {
        await deletePerson(b, f);
        await b.query("commit");
      },
    );
    expect(await orderStatus(f.orderId)).toBe("placing");
    expect(await roundState(f.roundId)).toBe("ordered/-");
  });

  it("deleting the person first: begin_placing waits, then places nothing", async () => {
    const f = await fixture("held");
    const a = await connect();
    const b = await connect();
    try {
      await deletePerson(b, f);
      const waiting = track(beginPlacing(a, f));
      await pause(300);
      expect(waiting.done(), "begin_placing waits for the round lock").toBe(false);
      await b.query("commit");
      expect((await waiting.promise).rowCount).toBe(0);
    } finally {
      await a.end();
      await b.end();
    }
    expect(await orderStatus(f.orderId)).toBe("cancelled");
    expect(await roundState(f.roundId)).toBe("skipped/-");
  });

  it("a cancel during the send_hold step leaves the round skipped", async () => {
    const f = await fixture("held", "funds");
    const engine = await connect();
    const user = await connect();
    try {
      // The engine claims the round itself, as the tick does.
      await admin.query("update concierge.gift_rounds set locked_until = null where id = $1", [f.roundId]);
      const claimed = await engine.query(
        "select (concierge.claim_round_now($1, now())).locked_until::text as lock",
        [f.roundId],
      );
      const lock: string = claimed.rows[0].lock;
      expect(lock).not.toBeNull();
      // The hold email is being sent when the buyer cancels.
      expect((await user.query("select concierge.cancel_held($1, 'cancel') as s", [f.roundId])).rows[0].s).toBe("skipped");
      await engine.query("select concierge.set_emailed_balance($1, 0)", [f.roundId]);
      await engine.query("select concierge.set_last_emailed_reason($1, 'funds')", [f.roundId]);
      await engine.query("select concierge.reconcile_round($1)", [f.roundId]);
      await engine.query("select concierge.release_round($1, $2::timestamptz)", [f.roundId, lock]);
    } finally {
      await engine.end();
      await user.end();
    }
    expect(await roundState(f.roundId)).toBe("skipped/-");
    expect(await orderStatus(f.orderId)).toBe("cancelled");
  });
});
