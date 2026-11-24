// Two real connections to local Supabase race the reaction functions: a
// double tap, two gifts answered at once, and a save against the daily close.
// Each locks the round row first, so one waits for the other. Skipped when
// the local database isn't running.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";

const dbUp = (await localStack({ api: false })) !== null;

// Long past, so a close on TODAY never reaches a round other work left unanswered.
const OCCASION = "2001-01-01";
const TODAY = "2001-03-01";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(): Promise<Client> {
  const c = new Client({ connectionString: LOCAL_DB });
  await c.connect();
  await c.query("set statement_timeout = 5000");
  return c;
}

describe.skipIf(!dbUp)("reaction races (two connections, local Supabase)", () => {
  let one: Client;
  let two: Client;
  let admin: Client;
  let userId: string;
  let personId: string;
  let roundId: string;
  let orders: string[];

  beforeAll(async () => {
    [one, two, admin] = await Promise.all([connect(), connect(), connect()]);
    await Promise.all([one, two].map((c) => c.query("set role service_role")));
  });

  afterAll(async () => {
    await Promise.all([one, two].map((c) => c.end()));
    await admin.end();
  });

  // After each test, so a round one test leaves delivered isn't closed by the next.
  afterEach(() => admin.query("delete from auth.users where id = $1", [userId]));

  // A delivered round holding two delivered gifts.
  beforeEach(async () => {
    userId = randomUUID();
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `reaction-${userId}@example.com`],
    );
    const person = await admin.query(
      "insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id",
      [userId],
    );
    personId = person.rows[0].id;
    const occasion = await admin.query(
      "insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id",
      [userId, personId],
    );
    const round = await admin.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                          budget_cents, status)
       values ($1, $2, $3, 2001, $4::date, $4::date - 10, 5000, 'delivered') returning id`,
      [userId, personId, occasion.rows[0].id, OCCASION],
    );
    roundId = round.rows[0].id;
    orders = [];
    for (const title of ["Mug", "Vase"]) {
      const idea = await admin.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
         values ($1, $2, $3, 4000, 4500, 1) returning id`,
        [userId, roundId, title],
      );
      const order = await admin.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, delivered_at,
                                       ship_to, ship_city, ship_state)
         values ($1, $2, $3, 'zinc_wallet', 4500, 100, 'delivered', '2001-01-01T12:00:00Z', 'recipient', 'Dayton', 'OH')
         returning id`,
        [userId, roundId, idea.rows[0].id],
      );
      orders.push(order.rows[0].id);
    }
  });

  async function save(c: Client, orderId: string): Promise<string> {
    const { rows } = await c.query(
      "select concierge.save_reaction($1, $2, 'loved', null, 'loved', $3, $4) as status",
      [userId, orderId, `Gift ${orderId}`, TODAY],
    );
    return rows[0].status;
  }
  const close = (c: Client) => c.query("select concierge.close_reacted_rounds($1)", [TODAY]);
  async function round(c: Client): Promise<{ status: string; updated_at: Date }> {
    const { rows } = await c.query("select status, updated_at from concierge.gift_rounds where id = $1", [roundId]);
    return rows[0];
  }

  /**
   * Runs `first` in an open transaction, checks that `second`, in another, waits for it, then
   * commits the first. The second is left open for the caller to commit or roll back.
   */
  async function secondWaits<T>(first: () => Promise<unknown>, second: () => Promise<T>): Promise<T> {
    await one.query("begin");
    await two.query("begin");
    try {
      await first();
      let done = false;
      const waiting = second().finally(() => (done = true));
      // Handled, in case the check below throws first.
      waiting.catch(() => {});
      await pause(200);
      expect(done).toBe(false);
      await one.query("commit");
      return await waiting;
    } catch (e) {
      await one.query("rollback");
      await two.query("rollback");
      throw e;
    }
  }

  it("a double tap leaves one row and one fact (AC-16)", async () => {
    await secondWaits(
      () => save(one, orders[0]),
      () => save(two, orders[0]),
    );
    await two.query("commit");
    const { rows } = await admin.query(
      `select (select count(*)::int from concierge.reactions where round_id = $1) as reactions,
              (select count(*)::int from concierge.profile_facts where person_id = $2) as facts`,
      [roundId, personId],
    );
    expect(rows[0]).toEqual({ reactions: 1, facts: 1 });
    expect((await round(admin)).status).toBe("delivered");
  });

  it("two gifts answered at once complete the round (AC-6)", async () => {
    const status = await secondWaits(
      () => save(one, orders[0]),
      () => save(two, orders[1]),
    );
    await two.query("commit");
    expect(status).toBe("complete");
    expect((await round(admin)).status).toBe("complete");
  });

  it("a close that waited for the last answer leaves the round as the save did (AC-6)", async () => {
    await save(admin, orders[0]);
    await secondWaits(
      () => save(one, orders[1]),
      () => close(two),
    );
    const saved = await round(admin);
    const seenByClose = await round(two);
    await two.query("rollback");
    expect(saved.status).toBe("complete");
    expect(seenByClose).toEqual(saved);
  });

  it("a close that waited while a gift turned out to arrive later doesn't close the round (AC-3)", async () => {
    await secondWaits(
      async () => {
        await one.query("select 1 from concierge.gift_rounds where id = $1 for update", [roundId]);
        await one.query("update concierge.orders set delivered_at = '2001-02-27T12:00:00Z' where id = $1", [orders[1]]);
      },
      () => close(two),
    );
    const seenByClose = await round(two);
    await two.query("rollback");
    expect(seenByClose.status).toBe("delivered");
  });

  it("an answer that waited for the close is still taken (AC-7)", async () => {
    const status = await secondWaits(
      async () => {
        await close(one);
        // This one is committed, so it must have closed this file's round and no other.
        const { rows } = await one.query(
          "select id from concierge.gift_rounds where status = 'complete' and updated_at = now()",
        );
        expect(rows).toEqual([{ id: roundId }]);
      },
      () => save(two, orders[0]),
    );
    await two.query("commit");
    expect(status).toBe("complete");
    const { rows } = await admin.query("select order_id from concierge.reactions where round_id = $1", [roundId]);
    expect(rows).toEqual([{ order_id: orders[0] }]);
  });
});
