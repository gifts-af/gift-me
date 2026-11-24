import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { roundView } from "../rounds/approval";
import { createSupabaseRoundStore } from "../rounds/store";
import { markGiftArrived } from "../tracking/arrived";
import { tellDelivered } from "../tracking/delivered";
import { heldRounds, type User } from "./round-engine-held";
import { captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// "It arrived" and the round screen's store-cancelled gifts (ALL-33 AC-11, AC-12, AC-14, AC-15,
// AC-16): the real markGiftArrived, mark_delivered, tellDelivered and roundView on the real local
// database (E5); only Zinc and the email service are faked. The tracking switch is read from the
// database, except in the one test that sees it off, which hands markGiftArrived a 0 so the shared
// database's switch is never flipped under another session's tests.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("It arrived (real local database)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, approve, newRound, sends } = held;
  const password = "local-only-password";

  /** A buyer who can sign in, so roundView reads as them (RLS is the real thing). */
  async function buyer(): Promise<User> {
    const email = `arrived-${randomUUID()}@example.com`;
    const { data, error } = await held.client().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    held.users.push(data.user.id);
    await held.pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, auto_topup_on) values ($1, true, '5555550100', null)", [
      data.user.id,
    ]);
    await held.connect(data.user.id);
    return { userId: data.user.id, email };
  }

  async function signedIn(u: User) {
    const s = stack!.supabase!;
    const db = createClient<Database>(s.url, s.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email: u.email, password });
    if (r.error) throw r.error;
    return db;
  }

  /** A round whose gifts are bought and placed with Zinc. Order ids in rank order. */
  async function placedRound(u: User, n = 1) {
    const r = await newRound(u, { totals: n === 2 ? [4200, 3000] : [4200] });
    for (const id of r.ideaIds) held.zinc.plan.set(`https://shop.test/p/${id}`, ["timeout"]);
    await approve(u, r);
    await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where round_id = $1 and status = 'held'", [r.roundId]);
    const rows = await held.pg.query(
      "select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank",
      [r.roundId],
    );
    const orderIds = rows.rows.map((x) => x.id as string);
    for (const orderId of orderIds) {
      await held.pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', $3::jsonb)", [
        u.userId,
        orderId,
        JSON.stringify({ provider_order_id: randomUUID(), total_cents: 3450 }),
      ]);
    }
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    return { ...r, orderIds };
  }
  const ship = (orderId: string) => held.pg.query("update concierge.orders set status = 'shipped' where id = $1", [orderId]);
  const orderRow = async (id: string) =>
    (await held.pg.query("select status, delivered_by, failure_type, resolved from concierge.orders where id = $1", [id])).rows[0];
  const roundStatus = async (roundId: string) =>
    (await held.pg.query("select status::text as s from concierge.gift_rounds where id = $1", [roundId])).rows[0].s as string;
  const inboxOf = (u: User) => mail.filter((m) => m.to === u.email).map((m) => m.subject);

  const deps = (o: { tracking?: number } = {}) => {
    const db = ownStaleOrders(held.client(), held.users);
    const notify = wiring(dayAt(0)).engine.notify;
    return {
      db,
      now: new Date(),
      setting: async (key: string) => {
        if (key === "order_tracking_enabled" && o.tracking !== undefined) return o.tracking;
        const row = (await held.pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0];
        if (!row) throw new Error(`Missing setting ${key}`);
        return Number(row.value);
      },
      tellDelivered: (roundId: string) => tellDelivered(roundId, { store: createSupabaseRoundStore(db), notify }),
    };
  };
  const arrived = (u: User, roundId: string, orderId: string, o: { tracking?: number } = {}) =>
    markGiftArrived({ userId: u.userId, roundId, orderId }, deps(o));

  it("markArrived on someone else's order is refused (AC-16)", async () => {
    const owner = await buyer();
    const r = await placedRound(owner);
    await ship(r.orderIds[0]);
    const other = await buyer();
    const mine = await placedRound(other);
    expect(await arrived(other, r.roundId, r.orderIds[0])).toEqual({ ok: false });
    // Their own round's id with someone else's order changes nothing either.
    expect(await arrived(other, mine.roundId, r.orderIds[0])).toEqual({ ok: false });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "shipped", delivered_by: null });
  });

  it("markArrived with order_tracking_enabled = 0 is refused (AC-15)", async () => {
    const u = await buyer();
    const r = await placedRound(u);
    await ship(r.orderIds[0]);
    expect(await arrived(u, r.roundId, r.orderIds[0], { tracking: 0 })).toEqual({ ok: false });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "shipped", delivered_by: null });
  });

  it("markArrived on placed is refused (AC-12)", async () => {
    const u = await buyer();
    const r = await placedRound(u);
    expect(await arrived(u, r.roundId, r.orderIds[0])).toEqual({ ok: false });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "placed", delivered_by: null });
  });

  it("markArrived on another of the buyer's own rounds' orders is refused", async () => {
    const u = await buyer();
    const a = await placedRound(u);
    const b = await placedRound(u);
    await ship(a.orderIds[0]);
    expect(await arrived(u, b.roundId, a.orderIds[0])).toEqual({ ok: false });
    expect(await orderRow(a.orderIds[0])).toMatchObject({ status: "shipped" });
  });

  it("markArrived last gift → round delivered and one delivered email (AC-11, AC-13)", async () => {
    const u = await buyer();
    const r = await placedRound(u, 2);
    await ship(r.orderIds[0]);
    await ship(r.orderIds[1]);
    const before = inboxOf(u).length;

    expect(await arrived(u, r.roundId, r.orderIds[0])).toEqual({ ok: true });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "delivered", delivered_by: "buyer" });
    // One gift still on its way: the round stays ordered, and nothing is sent yet.
    expect(await roundStatus(r.roundId)).toBe("ordered");
    expect(inboxOf(u).slice(before)).toEqual([]);

    expect(await arrived(u, r.roundId, r.orderIds[1])).toEqual({ ok: true });
    expect(await roundStatus(r.roundId)).toBe("delivered");
    expect(inboxOf(u).slice(before)).toEqual(["Mary's gift was delivered"]);
    expect(await sends(r.roundId)).toContain("delivered");

    // A second tap changes nothing and sends nothing.
    expect(await arrived(u, r.roundId, r.orderIds[1])).toEqual({ ok: false });
    expect(inboxOf(u).slice(before)).toHaveLength(1);
  });

  it("a late store cancel shows on the round screen (AC-14)", async () => {
    const u = await buyer();
    const r = await placedRound(u, 2);
    // The ship-by date is 30 days out: a cancel on day 31 is resolved at once, and the round keeps its other gift.
    await held.pg.query("select * from concierge.store_cancel_order($1, $2, current_date + 31, 3300)", [u.userId, r.orderIds[0]]);
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", failure_type: "store_cancelled", resolved: true });

    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.failedOrders).toEqual([]);
    expect(view?.storeCancelled).toEqual([
      expect.objectContaining({ id: r.orderIds[0], title: "Stoneware mug set", status: "failed", failureType: "store_cancelled", totalCents: 3450, refundCents: 3300 }),
    ]);
    expect(view?.liveOrders).toEqual([
      expect.objectContaining({
        id: r.orderIds[1],
        status: "placed",
        placedAt: expect.any(String),
        deliveredAt: null,
        packages: [],
        handlingDaysMax: 2,
        deliveryDaysMax: 5,
      }),
    ]);
  });

  it("roundView keeps a delivered gift with its day, and reads its packages", async () => {
    const u = await buyer();
    const r = await placedRound(u);
    await held.pg.query(
      `update concierge.orders set status = 'shipped', est_delivery_date = current_date + 3,
         packages = '[{"carrier":"UPS","tracking_number":"1Z999","status":"in_transit","estimated_delivery_date":null,"tracking_url":null}]'::jsonb
       where id = $1`,
      [r.orderIds[0]],
    );
    const shipped = await roundView(r.roundId, await signedIn(u), new Date());
    expect(shipped?.liveOrders[0].packages).toEqual([
      { carrier: "UPS", trackingNumber: "1Z999", status: "in_transit", estimatedDeliveryDate: null, trackingUrl: null },
    ]);
    await arrived(u, r.roundId, r.orderIds[0]);
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.liveOrders).toEqual([expect.objectContaining({ id: r.orderIds[0], status: "delivered", deliveredAt: expect.any(String) })]);
  });
});
