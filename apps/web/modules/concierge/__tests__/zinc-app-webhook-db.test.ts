// The app's Zinc webhook: events for card orders on the app's own Zinc account. Our database is
// real (local Supabase, E5); only Zinc is faked. The order is found first and the user comes from
// it; only card (connect) orders change here, and only wallet orders at a buyer's own webhook.
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { findConnectOrder, handleAppZincWebhook, handleZincWebhook } from "../zinc/events";
import { connectKey } from "../zinc/orders";
import { FakeZinc } from "./fake-zinc";

const stack = await localStack({ api: true });
const supabase = stack?.supabase ?? null;

const APP_KEY = `zn_test_app_${randomUUID()}`;
const APP_SECRET = `zn_whsec_app_${randomUUID()}`;
const SWITCHES = ["cost_tracking_enabled"];
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

describe.skipIf(!stack)("the app's Zinc webhook (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  let was: { key: string; value: string }[];
  let log: MockInstance<typeof console.log>;
  let failQuery = false;
  const placeHeld = vi.fn<(userId: string) => Promise<void>>(async () => {});
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => "advanced");
  const orderPlaced = vi.fn<(roundId: string) => Promise<unknown>>(async () => {});
  const tellDelivered = vi.fn<(roundId: string) => Promise<unknown>>(async () => {});

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    was = (await pg.query("select key, value from concierge.app_settings where key = any($1)", [SWITCHES])).rows;
  });
  afterAll(async () => {
    for (const { key, value } of was) await pg.query("update concierge.app_settings set value = $1 where key = $2", [value, key]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    await pg.query("update concierge.app_settings set value = '1' where key = 'cost_tracking_enabled'");
    zinc = new FakeZinc((key) => key === APP_KEY || users.some((u) => key === `zn_test_${u}`));
    failQuery = false;
    for (const f of [placeHeld, advanceRound, orderPlaced, tellDelivered]) f.mockClear();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    // The app key only ever reads here: nothing is created on the shared Zinc account.
    expect(zinc.requests.filter((r) => r.key === APP_KEY && r.method !== "GET")).toEqual([]);
    log.mockRestore();
  });

  const events = (name: string) =>
    log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => e.event === name);
  const alerts = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => e.alert === true);

  // Our database is real; failQuery makes reading the orders table report an error, like a dropped connection.
  function db() {
    const real = createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } });
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "schema") return Reflect.get(target, prop, receiver);
        return (schema: "concierge") => {
          const s = target.schema(schema);
          return new Proxy(s, {
            get(t, p, r) {
              if (p !== "from" || !failQuery) return Reflect.get(t, p, r);
              return () => {
                const broken = { data: null, error: { code: "XX000", message: "down" } };
                const chain: Record<string, unknown> = {};
                for (const m of ["select", "eq", "or", "limit", "order", "in"]) chain[m] = () => chain;
                chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(broken).then(ok);
                return chain;
              };
            },
          });
        };
      },
    });
  }
  const tracking = { order_tracking_enabled: 1, zinc_tracking_fetch_enabled: 0 } as Record<string, number>;
  const deps = () => ({
    db: db(),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
    env: "test" as const,
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
    placeHeld,
    advanceRound,
    orderPlaced,
    tellDelivered,
    setting: async (key: string): Promise<number> => {
      if (!(key in tracking)) throw new Error(`Unexpected setting ${key}.`);
      return tracking[key];
    },
  });
  const appDeps = () => ({ ...deps(), secret: APP_SECRET, connectKey: connectKey(APP_KEY) });
  const sendApp = (body: string, signature: string | null = sign(body, APP_SECRET)) => handleAppZincWebhook(body, signature, appDeps());

  // ─── fixtures ─────────────────────────────────────────────────────────────

  type User = { userId: string; webhookId: string | null; secret: string | null };
  async function newUser(card: boolean): Promise<User> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `app-webhook-${userId}@example.com`],
    );
    if (card) {
      await pg.query(
        `insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode, stripe_customer_id, stripe_payment_method_id)
         values ($1, true, '5555550100', 'connect', $2, $3)`,
        [userId, `cus_${userId}`, `pm_${userId}`],
      );
      return { userId, webhookId: null, secret: null };
    }
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode) values ($1, true, '5555550100', 'zinc_wallet')", [userId]);
    const webhookId = randomUUID();
    const secret = `zn_whsec_${randomUUID()}`;
    await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${userId}`, secret, webhookId]);
    return { userId, webhookId, secret };
  }

  /** One order placing at Zinc: a card order for $22.59 of goods (most it can charge $25.64), or a wallet one. */
  async function newOrder(u: User, o: { connect: boolean; saveProviderId?: boolean; status?: string }): Promise<{ orderId: string; roundId: string; zincId: string }> {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [u.userId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [u.userId, person.rows[0].id]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000, 'ordered', now()) returning id`,
      [u.userId, person.rows[0].id, occasion.rows[0].id],
    );
    const idea = await pg.query(
      "insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, goods_cents, rank) values ($1, $2, 'Mug', 2100, 2359, 2259, 1) returning id",
      [u.userId, round.rows[0].id],
    );
    const zincId = `zn_${randomUUID()}`;
    const order = o.connect
      ? await pg.query(
          `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, provider_order_id, ship_to, ship_city, ship_state,
                                         margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents, max_charge_cents, payment_method_id)
           values ($1, $2, $3, 'connect', 2259, 305, $4, $5, 'recipient', 'Dayton', 'OH', 100, 100, 290, 30, 2564, $6) returning id`,
          [u.userId, round.rows[0].id, idea.rows[0].id, o.status ?? "placing", o.saveProviderId === false ? null : zincId, `pm_${u.userId}`],
        )
      : await pg.query(
          `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, provider_order_id, ship_to, ship_city, ship_state)
           values ($1, $2, $3, 'zinc_wallet', 2359, 100, $4, $5, 'recipient', 'Dayton', 'OH') returning id`,
          [u.userId, round.rows[0].id, idea.rows[0].id, o.status ?? "placing", o.saveProviderId === false ? null : zincId],
        );
    const orderId = order.rows[0].id as string;
    await pg.query(
      `insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, $2, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US')`,
      [orderId, u.userId],
    );
    await pg.query("select concierge.reconcile_round($1)", [round.rows[0].id]);
    return { orderId, roundId: round.rows[0].id, zincId };
  }

  /** What Zinc has for the order: placed, with the goods total and (optionally) the card's whole charge. */
  function zincPlaced(o: { orderId: string; zincId: string }, finalCharge: number | null = 2564) {
    zinc.orders.set(o.orderId, {
      id: o.zincId,
      status: "order_placed",
      job_result: { success: true, price_components: { subtotal: 2100, shipping: 0, tax: 159, total: 2259 } },
      ...(finalCharge === null ? {} : { connect: { state: "captured", final_charge: finalCharge } }),
    });
  }

  const orderRow = async (id: string) =>
    (
      await pg.query(
        `select status, failure_type, total_cents, final_charge_cents, fee_cents, provider_order_id, updated_at::text as u
           from concierge.orders where id = $1`,
        [id],
      )
    ).rows[0];
  const costRows = async (orderId: string) =>
    (await pg.query("select kind, cents::int as cents, estimated from concierge.cost_events where order_id = $1 order by kind", [orderId])).rows;
  const savedCard = async (userId: string) =>
    (await pg.query("select stripe_payment_method_id as pm from concierge.accounts where user_id = $1", [userId])).rows[0].pm as string | null;

  const placedBody = (zincId: string) =>
    JSON.stringify({ event: "order.placed", order_id: zincId, data: { price_components: { subtotal: 1, shipping: 0, tax: 0, total: 1 } } });
  const shippedBody = (zincId: string) =>
    JSON.stringify({ event: "order.shipped", order_id: zincId, timestamp: new Date().toISOString(), data: { tracking_numbers: [] } });

  // ─── signature ────────────────────────────────────────────────────────────

  it("a bad or missing signature is 401 and changes nothing (AC-10)", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o);
    const body = placedBody(o.zincId);
    expect(await sendApp(body, sign(body, "wrong"))).toEqual({ status: 401 });
    expect(await sendApp(body, null)).toEqual({ status: 401 });
    expect(await orderRow(o.orderId)).toMatchObject({ status: "placing", total_cents: null });
    expect(zinc.requests).toEqual([]);
  });

  // ─── settling a card order ────────────────────────────────────────────────

  it("order.placed reads Zinc's order with the app key and saves Zinc's charge, not the event's prices (AC-8, AC-14)", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o);
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    expect(zinc.requests.map((r) => [r.method, r.path, r.key])).toEqual([["GET", "/orders", APP_KEY]]);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "placed", total_cents: 2259, final_charge_cents: 2564, fee_cents: 305, provider_order_id: o.zincId });
    expect(orderPlaced).toHaveBeenCalledWith(o.roundId);
    expect(alerts()).toEqual([]);
  });

  it("the same event twice is one settlement: one cost row of each kind, the first charge kept", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o);
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    const first = await orderRow(o.orderId);
    const costs = await costRows(o.orderId);
    expect(costs).toEqual([
      { kind: "card_fee", cents: 105, estimated: false },
      { kind: "zinc_order_fee", cents: 100, estimated: true },
    ]);
    zincPlaced(o, 2600);
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toEqual(first);
    expect(await costRows(o.orderId)).toEqual(costs);
  });

  it("a charge over the approved maximum alerts the owner from order.placed (AC-4)", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o, 2700);
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toMatchObject({ status: "placed", final_charge_cents: 2700 });
    expect(events("order.over_max_charge")).toEqual([
      expect.objectContaining({ order_id: o.orderId, user_id: u.userId, charge_cents: 2700, max_charge_cents: 2564, alert: true }),
    ]);
  });

  it("a tracking event on a card order still placing settles it with Zinc's charge first, and alerts over the maximum", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o, 2700);
    expect(await sendApp(shippedBody(o.zincId))).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toMatchObject({ status: "shipped", total_cents: 2259, final_charge_cents: 2700 });
    expect(orderPlaced).toHaveBeenCalledWith(o.roundId);
    expect(events("order.over_max_charge")).toHaveLength(1);
  });

  it("a failed read of Zinc's order before settling throws (Zinc retries) and leaves the order placing", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o);
    zinc.lookupStatus = 500;
    await expect(sendApp(placedBody(o.zincId))).rejects.toThrow();
    await expect(sendApp(shippedBody(o.zincId))).rejects.toThrow();
    expect(await orderRow(o.orderId)).toMatchObject({ status: "placing", total_cents: null });
  });

  it("a card order whose Zinc id was never saved is found through Zinc's metadata, with the app key", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true, saveProviderId: false });
    zincPlaced(o);
    expect(await findConnectOrder(o.zincId, appDeps())).toEqual({ orderId: o.orderId, userId: u.userId });
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    expect(zinc.requests.every((r) => r.key === APP_KEY)).toBe(true);
    expect(zinc.requests.map((r) => r.path)).toContain(`/orders/${o.zincId}`);
    expect(await orderRow(o.orderId)).toMatchObject({ status: "placed", provider_order_id: o.zincId, final_charge_cents: 2564 });
  });

  it("order.failed with a card code ends the gift card_needed and clears the saved card (AC-6)", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    const body = JSON.stringify({ event: "order.failed", order_id: o.zincId, data: { error_type: "payment_failed" } });
    expect(await sendApp(body)).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toMatchObject({ status: "failed", failure_type: "card_needed" });
    expect(await savedCard(u.userId)).toBeNull();
    expect(advanceRound).toHaveBeenCalledWith(o.roundId);
  });

  it("order.cancelled after the charge tells the buyer through the store-cancel path (AC-9)", async () => {
    const u = await newUser(true);
    const o = await newOrder(u, { connect: true });
    zincPlaced(o);
    await sendApp(placedBody(o.zincId));
    advanceRound.mockClear();
    const body = JSON.stringify({ event: "order.cancelled", order_id: o.zincId, data: { refund_amount: 2564 } });
    expect(await sendApp(body)).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toMatchObject({ status: "failed", failure_type: "store_cancelled" });
    expect(advanceRound).toHaveBeenCalledWith(o.roundId);
  });

  // ─── which webhook changes which orders ───────────────────────────────────

  it("a definite unknown order is 200 with zinc.unknown_order alerting (AC-10)", async () => {
    const zincId = `zn_${randomUUID()}`;
    expect(await findConnectOrder(zincId, appDeps())).toBeNull();
    expect(await sendApp(placedBody(zincId))).toEqual({ status: 200 });
    expect(events("zinc.unknown_order")).toEqual([expect.objectContaining({ provider_order_id: zincId, alert: true })]);
  });

  it("a failed lookup throws, so Zinc retries: our database down, or Zinc 5xx on the metadata read", async () => {
    const zincId = `zn_${randomUUID()}`;
    failQuery = true;
    await expect(findConnectOrder(zincId, appDeps())).rejects.toThrow();
    await expect(sendApp(placedBody(zincId))).rejects.toThrow();
    failQuery = false;
    zinc.lookupStatus = 500;
    await expect(findConnectOrder(zincId, appDeps())).rejects.toThrow();
    await expect(sendApp(placedBody(zincId))).rejects.toThrow();
    expect(events("zinc.unknown_order")).toEqual([]);
  });

  it("a wallet order's id on the app webhook changes nothing and doesn't alert", async () => {
    const u = await newUser(false);
    const o = await newOrder(u, { connect: false });
    const before = await orderRow(o.orderId);
    for (const body of [placedBody(o.zincId), shippedBody(o.zincId), JSON.stringify({ event: "order.cancelled", order_id: o.zincId })]) {
      expect(await sendApp(body)).toEqual({ status: 200 });
    }
    expect(await orderRow(o.orderId)).toEqual(before);
    expect(alerts()).toEqual([]);
    expect(zinc.requests).toEqual([]);
  });

  it("a wallet order found only through Zinc's metadata on the app webhook changes nothing and doesn't alert", async () => {
    const u = await newUser(false);
    const o = await newOrder(u, { connect: false, saveProviderId: false });
    zincPlaced(o);
    const before = await orderRow(o.orderId);
    expect(await sendApp(placedBody(o.zincId))).toEqual({ status: 200 });
    expect(await orderRow(o.orderId)).toEqual(before);
    expect(alerts()).toEqual([]);
  });

  it("a card order's id on a buyer's own webhook changes nothing and doesn't alert, theirs or another buyer's", async () => {
    // A wallet buyer (the owner) whose Zinc account is the app's: their key can read card orders too.
    const owner = await newUser(false);
    const cardBuyer = await newUser(true);
    const others = await newOrder(cardBuyer, { connect: true });
    zincPlaced(others);
    const unsaved = await newOrder(cardBuyer, { connect: true, saveProviderId: false });
    zincPlaced(unsaved);
    // The owner's own card order (their account switched later; the order keeps its mode).
    const own = await newOrder(owner, { connect: true });
    zincPlaced(own);
    const rows = await Promise.all([others, unsaved, own].map((o) => orderRow(o.orderId)));
    for (const o of [others, unsaved, own]) {
      for (const body of [placedBody(o.zincId), shippedBody(o.zincId), JSON.stringify({ event: "order.cancelled", order_id: o.zincId })]) {
        expect(await handleZincWebhook(owner.webhookId!, body, sign(body, owner.secret!), deps())).toEqual({ status: 200 });
      }
    }
    expect(await Promise.all([others, unsaved, own].map((o) => orderRow(o.orderId)))).toEqual(rows);
    expect(alerts()).toEqual([]);
  });

  it("wallet events on the app webhook are ignored", async () => {
    for (const event of ["wallet.auto_topup.succeeded", "wallet.auto_topup.disabled", "wallet.auto_topup.failed"]) {
      expect(await sendApp(JSON.stringify({ event, data: {} }))).toEqual({ status: 200 });
    }
    expect(placeHeld).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("a signed body that isn't an event is acknowledged without effect", async () => {
    expect(await sendApp("not json")).toEqual({ status: 200 });
    expect(await sendApp(JSON.stringify({ nope: 1 }))).toEqual({ status: 200 });
    expect(zinc.requests).toEqual([]);
  });
});
