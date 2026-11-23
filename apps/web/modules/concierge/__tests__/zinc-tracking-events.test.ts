// Zinc tracking, shipped, estimate and delivered events (ALL-33 Task 3). Our own database is
// real (local Supabase, E5); only Zinc is faked. Skipped when the local database isn't running.
// Settings are read from the real app_settings, except where a test overrides one in memory:
// the local database is shared, so no test changes a setting there.
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { handleZincWebhook } from "../zinc/events";

const stack = await localStack({ api: true });
const dbUp = stack !== null;
const supabase = stack?.supabase ?? null;

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

describe.skipIf(!dbUp)("Zinc tracking events (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  const placeHeld = vi.fn<(userId: string) => Promise<void>>(async () => {});
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => {});
  const orderPlaced = vi.fn<(roundId: string) => Promise<unknown>>(async () => {});
  const tellDelivered = vi.fn<(roundId: string) => Promise<unknown>>(async () => {});
  const zincGets: string[] = [];
  const zincOrders: Record<string, unknown> = {};
  const zincStatus: Record<string, number> = {};
  let overrides: Record<string, number> = {};

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(() => {
    overrides = {};
    for (const f of [placeHeld, advanceRound, orderPlaced, tellDelivered]) f.mockClear();
  });

  const fakeFetch = (async (url: string) => {
    const id = new URL(url).pathname.replace("/orders/", "");
    zincGets.push(id);
    const forced = zincStatus[id];
    if (forced) return new Response(null, { status: forced });
    const order = zincOrders[id];
    return new Response(order ? JSON.stringify(order) : null, { status: order ? 200 : 404 });
  }) as unknown as typeof fetch;

  async function setting(key: string): Promise<number> {
    if (key in overrides) return overrides[key];
    const { rows } = await pg.query("select value from concierge.app_settings where key = $1", [key]);
    if (!rows.length) throw new Error(`Setting ${key} is missing.`);
    return Number(rows[0].value);
  }

  const deps = () => ({
    db: createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } }),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: fakeFetch },
    env: "test" as const,
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
    placeHeld,
    advanceRound,
    orderPlaced,
    tellDelivered,
    setting,
  });

  type Account = { userId: string; webhookId: string; secret: string };
  async function newAccount(): Promise<Account> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `tracking-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [userId]);
    const webhookId = randomUUID();
    const secret = `zn_whsec_${randomUUID()}`;
    await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${randomUUID()}`, secret, webhookId]);
    return { userId, webhookId, secret };
  }

  /** An order Zinc knows as `zincId`: placed (the usual case) or still placing (order.placed was lost). */
  async function newOrder(a: Account, zincId: string, status: "placed" | "placing" = "placed", occasionInDays = 37) {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [a.userId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [a.userId, person.rows[0].id]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + $4::int, current_date + $4::int - 7, 5000, 'ordered', now()) returning id`,
      [a.userId, person.rows[0].id, occasion.rows[0].id, occasionInDays],
    );
    const idea = await pg.query(
      "insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank) values ($1, $2, 'Mug', 4000, 4500, 1) returning id",
      [a.userId, round.rows[0].id],
    );
    const order = await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, provider_order_id, ship_to, ship_city, ship_state)
       values ($1, $2, $3, 'zinc_wallet', 4500, 100, 'placing', $4, 'recipient', 'Dayton', 'OH') returning id`,
      [a.userId, round.rows[0].id, idea.rows[0].id, zincId],
    );
    const orderId: string = order.rows[0].id;
    const roundId: string = round.rows[0].id;
    await pg.query("select concierge.reconcile_round($1)", [roundId]);
    if (status === "placed") {
      await pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', '{}'::jsonb)", [a.userId, orderId]);
    }
    return { orderId, roundId };
  }

  const orderRow = async (id: string) =>
    (
      await pg.query(
        `select status, packages, est_delivery_date::text as est, placed_at is not null as placed, delivered_by,
                tracking_event_at, updated_at::text as u
           from concierge.orders where id = $1`,
        [id],
      )
    ).rows[0];
  const roundStatus = async (id: string) => (await pg.query("select status::text as s from concierge.gift_rounds where id = $1", [id])).rows[0].s;

  const ups = { carrier: "UPS", tracking_number: "1Z999", status: "in_transit" };
  const event = (name: string, zincId: string, data: Record<string, unknown> = {}, timestamp = "2030-12-01T10:00:00Z") =>
    JSON.stringify({ event: name, order_id: zincId, timestamp, data });
  const shippedBody = (zincId: string, timestamp?: string) => event("order.shipped", zincId, { tracking_numbers: [ups] }, timestamp);
  const send = (a: Account, body: string, id = a.webhookId) => handleZincWebhook(id, body, sign(body, a.secret), deps());

  /** Zinc's Get Order with an estimate and the extra fields we must never keep. */
  const zincOrderWithEstimate = (zincId: string, est = "2030-12-05") => {
    zincOrders[zincId] = {
      id: zincId,
      tracking_numbers: [
        {
          ...ups,
          estimated_delivery_date: est,
          zinc_tracking_url: "https://track.zinc.test/1Z999",
          delivery_proof_url: "https://proof.test/photo.jpg",
          checkpoints: [{ location: "Dayton, OH" }],
        },
      ],
    };
  };

  function logLines(spy: { mock: { calls: unknown[][] } }, name: string) {
    return spy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes(`"${name}"`))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it("shipped saves whitelisted packages and the fetched estimate", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    expect(await send(a, shippedBody(zincId))).toEqual({ status: 200 });
    expect(zincGets).toContain(zincId);
    const row = await orderRow(orderId);
    expect(row).toMatchObject({ status: "shipped", est: "2030-12-05" });
    expect(row.packages).toEqual([
      {
        carrier: "UPS",
        tracking_number: "1Z999",
        status: "in_transit",
        estimated_delivery_date: "2030-12-05",
        tracking_url: "https://track.zinc.test/1Z999",
      },
    ]);
    // tracking_received saves too, without moving the order to shipped.
    const b = randomUUID();
    const other = await newOrder(a, b);
    zincOrderWithEstimate(b, "2030-12-07");
    await send(a, event("order.tracking_received", b, { tracking_numbers: [ups] }));
    expect(await orderRow(other.orderId)).toMatchObject({ status: "placed", est: "2030-12-07" });
  });

  it("the same shipped event twice saves once", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    await send(a, shippedBody(zincId));
    const first = await orderRow(orderId);
    expect(await send(a, shippedBody(zincId))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toEqual(first);
    // An older event after it changes nothing either.
    await send(a, event("order.tracking_received", zincId, { tracking_numbers: [{ ...ups, status: "label_created" }] }, "2030-11-30T10:00:00Z"));
    expect(await orderRow(orderId)).toEqual(first);
  });

  it("shipped on a placing order settles it placed first and sends the ordered email", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, zincId, "placing");
    zincOrderWithEstimate(zincId);
    await send(a, shippedBody(zincId));
    expect(await orderRow(orderId)).toMatchObject({ status: "shipped", placed: true, est: "2030-12-05" });
    expect(orderPlaced).toHaveBeenCalledTimes(1);
    expect(orderPlaced).toHaveBeenCalledWith(roundId);
  });

  it("estimate updated saves the new date", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    await send(a, shippedBody(zincId));
    const gets = zincGets.length;
    await send(a, event("order.estimated_delivery_updated", zincId, { estimated_delivery: "2030-12-09T00:00:00Z" }, "2030-12-02T10:00:00Z"));
    expect(await orderRow(orderId)).toMatchObject({ status: "shipped", est: "2030-12-09" });
    expect(zincGets.length).toBe(gets);
  });

  it("delivered moves the round to delivered and calls tellDelivered once", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    await send(a, shippedBody(zincId));
    await send(a, event("order.delivered", zincId));
    expect(await orderRow(orderId)).toMatchObject({ status: "delivered", delivered_by: "zinc" });
    expect(await roundStatus(roundId)).toBe("delivered");
    // A repeat changes nothing and is logged as ignored, with ids only.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await send(a, event("order.delivered", zincId));
      expect(logLines(log, "tracking.event_ignored")).toEqual([
        expect.objectContaining({ user_id: a.userId, order_id: orderId, status: "delivered" }),
      ]);
    } finally {
      log.mockRestore();
    }
    expect(tellDelivered).toHaveBeenCalledTimes(1);
    expect(tellDelivered).toHaveBeenCalledWith(roundId);
  });

  it("a tellDelivered throw is logged and the webhook still answers 200", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    tellDelivered.mockRejectedValueOnce(new Error("email down"));
    expect(await send(a, event("order.delivered", zincId))).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toMatchObject({ status: "delivered" });
  });

  it("off switch logs and changes nothing", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    overrides.order_tracking_enabled = 0;
    const before = await orderRow(orderId);
    const gets = zincGets.length;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const name of ["order.shipped", "order.tracking_received", "order.estimated_delivery_updated", "order.delivered"]) {
        expect(await send(a, event(name, zincId, { tracking_numbers: [ups], estimated_delivery: "2030-12-09" }))).toEqual({ status: 200 });
      }
      expect(logLines(log, "tracking.event_ignored")).toHaveLength(4);
      expect(logLines(log, "tracking.event_ignored")[0]).toMatchObject({ user_id: a.userId, reason: "off" });
    } finally {
      log.mockRestore();
    }
    expect(await orderRow(orderId)).toEqual(before);
    expect(await roundStatus(roundId)).toBe("ordered");
    expect(zincGets.length).toBe(gets);
    expect(tellDelivered).not.toHaveBeenCalled();
  });

  it("another user's webhook id is 401", async () => {
    const a = await newAccount();
    const b = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    const before = await orderRow(orderId);
    expect(await send(a, shippedBody(zincId), b.webhookId)).toEqual({ status: 401 });
    expect(await send(a, event("order.delivered", zincId), b.webhookId)).toEqual({ status: 401 });
    // b's own (validly signed) events can't reach a's order either.
    const sentByB = event("order.delivered", zincId);
    expect(await handleZincWebhook(b.webhookId, sentByB, sign(sentByB, b.secret), deps())).toEqual({ status: 200 });
    expect(await orderRow(orderId)).toEqual(before);
  });

  it("estimate fetch failing still saves packages", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincStatus[zincId] = 503;
    expect(await send(a, shippedBody(zincId))).toEqual({ status: 200 });
    const row = await orderRow(orderId);
    expect(row).toMatchObject({ status: "shipped", est: null });
    expect(row.packages).toEqual([{ carrier: "UPS", tracking_number: "1Z999", status: "in_transit" }]);
  });

  it("zinc_tracking_fetch_enabled = 0 saves packages without fetching", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    overrides.zinc_tracking_fetch_enabled = 0;
    const gets = zincGets.length;
    await send(a, shippedBody(zincId));
    expect(zincGets.length).toBe(gets);
    const row = await orderRow(orderId);
    expect(row).toMatchObject({ status: "shipped", est: null });
    expect(row.packages).toEqual([{ carrier: "UPS", tracking_number: "1Z999", status: "in_transit" }]);
  });

  it("a late shipped event sends no email itself (news waits for the daily run)", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    // The occasion is in 3 days; the carrier says 10.
    const { orderId } = await newOrder(a, zincId, "placed", 3);
    const late = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    zincOrderWithEstimate(zincId, late);
    await send(a, shippedBody(zincId));
    expect(await orderRow(orderId)).toMatchObject({ status: "shipped", est: late });
    for (const f of [orderPlaced, advanceRound, tellDelivered, placeHeld]) expect(f).not.toHaveBeenCalled();
  });

  it("two copies of the same event at once change the order once", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId, roundId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    const results = await Promise.all([send(a, shippedBody(zincId)), send(a, shippedBody(zincId))]);
    expect(results).toEqual([{ status: 200 }, { status: 200 }]);
    const row = await orderRow(orderId);
    expect(row).toMatchObject({ status: "shipped", est: "2030-12-05" });
    expect(row.packages).toHaveLength(1);
    await Promise.all([send(a, event("order.delivered", zincId)), send(a, event("order.delivered", zincId))]);
    expect(await roundStatus(roundId)).toBe("delivered");
    expect(tellDelivered).toHaveBeenCalledTimes(1);
  });

  it("available_for_pickup is logged and ignored", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    const before = await orderRow(orderId);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await send(a, event("order.available_for_pickup", zincId, { tracking_numbers: [ups] }))).toEqual({ status: 200 });
      expect(logLines(log, "tracking.event_ignored")).toEqual([expect.objectContaining({ user_id: a.userId, reason: "pickup" })]);
    } finally {
      log.mockRestore();
    }
    expect(await orderRow(orderId)).toEqual(before);
  });

  it("logs tracking.order_updated with ids only", async () => {
    const a = await newAccount();
    const zincId = randomUUID();
    const { orderId } = await newOrder(a, zincId);
    zincOrderWithEstimate(zincId);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await send(a, shippedBody(zincId));
      const lines = logLines(log, "tracking.order_updated");
      expect(lines).toEqual([expect.objectContaining({ user_id: a.userId, order_id: orderId, zinc_event: "order.shipped", status: "shipped" })]);
      const all = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).not.toContain("1Z999");
      expect(all).not.toContain("track.zinc.test");
    } finally {
      log.mockRestore();
    }
  });
});
