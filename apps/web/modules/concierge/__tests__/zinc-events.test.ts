// @vitest-environment node
// Zinc webhooks (ALL-32 Task 5, AC-13, AC-14, AC-26). Our own database is real
// (local Supabase, E5); only Zinc is faked. Skipped when the local database isn't running.
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { localSupabase } from "../../../e2e/local-supabase";
import { handleZincWebhook } from "../zinc/events";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function localDbUp(): Promise<boolean> {
  const c = new Client({ connectionString: LOCAL_DB, connectionTimeoutMillis: 1000 });
  try {
    await c.connect();
    await c.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const dbUp = await localDbUp();
const supabase = dbUp ? localSupabase() : null;

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

describe.skipIf(!dbUp)("Zinc webhooks (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  const placeHeld = vi.fn<(userId: string) => Promise<void>>(async () => {});
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => "advanced");
  const zincGets: string[] = [];
  const zincOrders: Record<string, unknown> = {};
  const zincStatus: Record<string, number> = {};
  let failRpc: string | null = null;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  const fakeFetch = (async (url: string) => {
    const path = new URL(url).pathname;
    zincGets.push(path);
    const order = zincOrders[path.replace("/orders/", "")];
    const forced = zincStatus[path.replace("/orders/", "")];
    if (forced) return new Response(null, { status: forced });
    return new Response(order ? JSON.stringify(order) : null, { status: order ? 200 : 404 });
  }) as unknown as typeof fetch;
  // Our database is real; failRpc makes one named function report an error, like a dropped connection would.
  function db() {
    const real = createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } });
    if (!failRpc) return real;
    const name = failRpc;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "schema") return Reflect.get(target, prop, receiver);
        return (schema: "concierge") => {
          const s = target.schema(schema);
          return new Proxy(s, {
            get(t, p, r) {
              if (p !== "rpc") return Reflect.get(t, p, r);
              return (fn: string, args: never) =>
                fn === name ? Promise.resolve({ data: null, error: { code: "XX000", message: "down" } }) : (t.rpc as (f: string, a: never) => unknown).call(t, fn, args);
            },
          });
        };
      },
    });
  }
  const deps = () => ({
    db: db(),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: fakeFetch },
    env: "test" as const,
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
    placeHeld,
    advanceRound,
  });

  type Account = { userId: string; webhookId: string; secret: string };
  async function newAccount(): Promise<Account> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `events-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [userId]);
    const webhookId = randomUUID();
    const secret = `zn_whsec_${randomUUID()}`;
    await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${randomUUID()}`, secret, webhookId]);
    return { userId, webhookId, secret };
  }

  async function newOrder(
    a: Account,
    o: { funding?: string; providerOrderId?: string | null } = {},
  ): Promise<{ orderId: string; roundId: string }> {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [a.userId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [a.userId, person.rows[0].id]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000, 'ordered', now()) returning id`,
      [a.userId, person.rows[0].id, occasion.rows[0].id],
    );
    const idea = await pg.query(
      "insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank) values ($1, $2, 'Mug', 4000, 4500, 1) returning id",
      [a.userId, round.rows[0].id],
    );
    const order = await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, provider_order_id, ship_to, ship_city, ship_state)
       values ($1, $2, $3, $4, 4500, 100, 'placing', $5, 'recipient', 'Dayton', 'OH') returning id`,
      [a.userId, round.rows[0].id, idea.rows[0].id, o.funding ?? "zinc_wallet", o.providerOrderId ?? null],
    );
    await pg.query(
      `insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, $2, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US')`,
      [order.rows[0].id, a.userId],
    );
    await pg.query("select concierge.reconcile_round($1)", [round.rows[0].id]);
    return { orderId: order.rows[0].id, roundId: round.rows[0].id };
  }

  const orderRow = async (id: string) =>
    (
      await pg.query(
        "select status, failure_type, subtotal_cents, shipping_cents, tax_cents, total_cents, provider_order_id, updated_at::text as u from concierge.orders where id = $1",
        [id],
      )
    ).rows[0];
  const roundRow = async (id: string) =>
    (await pg.query("select status::text as status, attention_reason from concierge.gift_rounds where id = $1", [id])).rows[0];

  const placedBody = (zincId: string) =>
    JSON.stringify({
      event: "order.placed",
      order_id: zincId,
      status: "order_placed",
      data: { price_components: { subtotal: 4500, shipping: 0, tax: 360, total: 4860 } },
    });
  const send = (a: Account, body: string, secret = a.secret, id = a.webhookId) => handleZincWebhook(id, body, sign(body, secret), deps());

  it("refuses a wrong signature, another user's secret and an unknown id, and writes nothing", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, { providerOrderId: zincId });
    const body = placedBody(zincId);
    zincOrders[zincId] = { id: zincId, metadata: { order_id: orderId } };
    const getsBefore = zincGets.length;
    expect(await send(a, body, "wrong")).toEqual({ status: 401 });
    expect(await send(a, body, b.secret)).toEqual({ status: 401 });
    expect(await send(a, body, a.secret, randomUUID())).toEqual({ status: 401 });
    expect(await handleZincWebhook(a.webhookId, body, null, deps())).toEqual({ status: 401 });
    expect(await orderRow(orderId)).toMatchObject({ status: "placing", total_cents: null });
    expect(zincGets.length).toBe(getsBefore);
  });

  it("order.placed saves the price parts and moves the order to placed", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, { providerOrderId: zincId });
    expect(await send(a, placedBody(zincId))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({
      status: "placed",
      subtotal_cents: 4500,
      shipping_cents: 0,
      tax_cents: 360,
      total_cents: 4860,
      provider_order_id: zincId,
    });
    expect((await roundRow(roundId)).status).toBe("ordered");
  });

  it("order.placed settles an order whose provider_order_id was never saved, by asking Zinc for our reference", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a);
    zincOrders[zincId] = { id: zincId, metadata: { order_id: orderId } };
    expect(await send(a, placedBody(zincId))).toEqual({ status: 200 });
    expect(zincGets).toContain(`/orders/${zincId}`);
    expect(await orderRow(orderId)).toMatchObject({ status: "placed", total_cents: 4860, provider_order_id: zincId });
  });

  it("an order we can't match is acknowledged and changes nothing, and another user's order is never touched", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const mine = await newOrder(a);
    const theirs = await newOrder(b);
    const zincId = randomUUID();
    zincOrders[zincId] = { id: zincId, metadata: { order_id: theirs.orderId } };
    expect(await send(a, placedBody(zincId))).toEqual({ status: 200 });
    expect(await send(a, placedBody(randomUUID()))).toEqual({ status: 200 });
    expect(await orderRow(theirs.orderId)).toMatchObject({ status: "placing" });
    expect(await orderRow(mine.orderId)).toMatchObject({ status: "placing" });
  });

  it("order.failed max_price_exceeded becomes price_up", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, { providerOrderId: zincId, funding: "zinc_wallet" });
    const body = JSON.stringify({ event: "order.failed", order_id: zincId, data: { error_type: "max_price_exceeded", error: "too much" } });
    expect(await send(a, body)).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "failed", failure_type: "price_up" });
    expect(await roundRow(roundId)).toMatchObject({ status: "needs_attention", attention_reason: "price_up" });
  });

  it("a failure is emailed at once: the engine takes the round straight away (ALL-32, owner rule)", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { roundId } = await newOrder(a, { providerOrderId: zincId, funding: "zinc_wallet" });
    advanceRound.mockClear();
    await send(a, JSON.stringify({ event: "order.failed", order_id: zincId, data: { error_type: "out_of_stock" } }));
    expect(advanceRound).toHaveBeenCalledWith(roundId);
    // A placed order needs nothing from the buyer.
    const other = randomUUID();
    await newOrder(a, { providerOrderId: other });
    advanceRound.mockClear();
    await send(a, placedBody(other));
    expect(advanceRound).not.toHaveBeenCalled();
  });

  it("a duplicate event is one write", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, { providerOrderId: zincId });
    await send(a, placedBody(zincId));
    const first = await orderRow(orderId);
    expect(await send(a, placedBody(zincId))).toEqual({ status: 200 });
    // A late failure for an order that is already placed changes nothing either.
    await send(a, JSON.stringify({ event: "order.failed", order_id: zincId, data: { error_type: "out_of_stock" } }));
    expect(await orderRow(orderId)).toEqual(first);
  });

  it("auto_topup.succeeded turns it on and places held orders once; disabled turns it off", async () => {
    const a = await newAccount();
    placeHeld.mockClear();
    const on = JSON.stringify({ event: "wallet.auto_topup.succeeded", data: { amount_cents: 50000, status: "success" } });
    expect(await send(a, on)).toEqual({ status: 200 });
    expect(placeHeld).toHaveBeenCalledTimes(1);
    expect(placeHeld).toHaveBeenCalledWith(a.userId);
    const flag = async () => (await pg.query("select auto_topup_on from concierge.accounts where user_id = $1", [a.userId])).rows[0].auto_topup_on;
    expect(await flag()).toBe(true);
    const off = JSON.stringify({ event: "wallet.auto_topup.disabled", data: { amount_cents: 0, status: "disabled" } });
    expect(await send(a, off)).toEqual({ status: 200 });
    expect(await flag()).toBe(false);
    expect(placeHeld).toHaveBeenCalledTimes(1);
  });

  it("a signed body that is not an event is acknowledged without effect", async () => {
    const a = await newAccount();
    expect(await send(a, "not json")).toEqual({ status: 200 });
    expect(await send(a, JSON.stringify({ nope: true }))).toEqual({ status: 200 });
  });

  const failedBody = (zincId: string, errorType: string) =>
    JSON.stringify({ event: "order.failed", order_id: zincId, data: { error_type: errorType, error: "x" } });

  it.each([
    ["out_of_stock", "out_of_stock"],
    ["invalid_shipping_address", "invalid_shipping_address"],
    ["something_new", "failed"],
  ])("order.failed %s is stored as %s", async (errorType, stored) => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, { providerOrderId: zincId });
    expect(await send(a, failedBody(zincId, errorType))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "failed", failure_type: stored });
  });

  it("auto_topup.failed leaves the setting alone", async () => {
    const a = await newAccount();
    await pg.query("update concierge.accounts set auto_topup_on = true where user_id = $1", [a.userId]);
    placeHeld.mockClear();
    const body = JSON.stringify({ event: "wallet.auto_topup.failed", data: { amount_cents: 1, status: "failed", error: "declined" } });
    expect(await send(a, body)).toEqual({ status: 200 });
    expect((await pg.query("select auto_topup_on from concierge.accounts where user_id = $1", [a.userId])).rows[0].auto_topup_on).toBe(true);
    expect(placeHeld).not.toHaveBeenCalled();
  });

  it("a bad price block still records the status, without prices, and answers 200", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, { providerOrderId: zincId });
    const body = JSON.stringify({ event: "order.placed", order_id: zincId, data: { price_components: { subtotal: 4500, total: 4860.5 } } });
    expect(await send(a, body)).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "placed", subtotal_cents: null, total_cents: null, provider_order_id: zincId });
  });

  it("a database error reading the key is a failure (Zinc retries), not a dropped event", async () => {
    const a = await newAccount();
    const { orderId } = await newOrder(a);
    const zincId = randomUUID();
    zincOrders[zincId] = { id: zincId, metadata: { order_id: orderId } };
    failRpc = "zinc_secrets";
    try {
      await expect(send(a, placedBody(zincId))).rejects.toThrow();
    } finally {
      failRpc = null;
    }
    expect(await orderRow(orderId)).toMatchObject({ status: "placing" });
  });

  it("Zinc being unavailable on the fallback lookup is a failure; a definitive 404 is acknowledged", async () => {
    const a = await newAccount();
    const { orderId } = await newOrder(a);
    const down = randomUUID();
    zincStatus[down] = 503;
    await expect(send(a, placedBody(down))).rejects.toThrow();
    const limited = randomUUID();
    zincStatus[limited] = 429;
    await expect(send(a, placedBody(limited))).rejects.toThrow();
    const gone = randomUUID();
    zincStatus[gone] = 404;
    expect(await send(a, placedBody(gone))).toEqual({ status: 200 });
    const denied = randomUUID();
    zincStatus[denied] = 401;
    expect(await send(a, placedBody(denied))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "placing" });
  });

  it("an order that already has a different provider_order_id is not overwritten", async () => {
    const a = await newAccount();
    const saved = randomUUID();
    const { orderId } = await newOrder(a, { providerOrderId: saved });
    const other = randomUUID();
    zincOrders[other] = { id: other, metadata: { order_id: orderId } };
    expect(await send(a, placedBody(other))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "placing", provider_order_id: saved });
  });
});
