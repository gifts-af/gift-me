import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addDays, type Database } from "@gifts-af/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { advanceRound } from "../rounds/engine";
import { tellOrdered } from "../rounds/money-path";
import { createSupabaseRoundStore } from "../rounds/store";
import { runTrackingNews } from "../tracking/news";
import { quoteFailedOrder, replaceFailedOrder } from "../purchase/replace";
import { heldRounds, type User } from "./round-engine-held";
import { captureLog, events, named } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));
let current: SupabaseClient<Database>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
const { createSupabasePeopleStore } = await import("../people/store");

// A date change on the money path, on the real local database (E5): what a round with failed gifts
// says and does once its date moves, and what saving the date reads.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("a moved date on the money path (real local database, fake Zinc)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, approve, newUser, newRound, sends } = held;

  beforeAll(async () => {
    await held.pg.query("insert into concierge.app_settings (key, value) values ('moved_dates_close_rounds', '1') on conflict (key) do update set value = '1'");
  });
  afterAll(async () => {
    await held.pg.query("update concierge.app_settings set value = '1' where key = 'moved_dates_close_rounds'");
  });

  /** A birthday round (Dec 28) whose only gift Zinc turned down; `told`, the buyer was emailed. */
  async function failedRound(u: User, o: { deadlineIn?: number; type?: string; told?: boolean } = {}) {
    const r = await newRound(u, { deadlineIn: o.deadlineIn ?? 30 });
    await held.pg.query(
      "update concierge.occasions set kind = 'birthday', month = 12, day = 28 where id = (select occasion_id from concierge.gift_rounds where id = $1)",
      [r.roundId],
    );
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const orderId = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows[0].id as string;
    await held.pg.query("update concierge.orders set status = 'failed', hold_reason = null, failure_type = $2 where id = $1", [orderId, o.type ?? "price_up"]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    if (o.told) await held.pg.query("insert into concierge.round_sends (round_id, user_id, step) values ($1, $2, $3)", [r.roundId, u.userId, `fail:${orderId}`]);
    return { ...r, orderId };
  }
  const occasionOf = async (roundId: string) => (await held.pg.query("select occasion_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].occasion_id as string;
  const move = async (roundId: string) => held.pg.query("update concierge.occasions set month = 12, day = 20 where id = $1", [await occasionOf(roundId)]);
  const texts = (u: User) => mail.filter((m) => m.to === u.email).map((m) => m.text);
  const quiet = () => {
    expect(named("round_failed")).toEqual([]);
    expect(named("round_ended_by_move")).toHaveLength(1);
    expect(events().filter((e) => e.alert === true)).toEqual([]);
  };
  /** Advances on day `n`, moving the date just before the store's first `method` call. */
  async function advanceMoving(roundId: string, n: number, method: "holdsLease" | "release") {
    const { engine } = wiring(dayAt(n), { zinc: false });
    const real = engine.store;
    let done = false;
    const store = {
      ...real,
      [method]: async (id: string, lock: Date) => {
        if (!done) await move(roundId);
        done = true;
        return real[method](id, lock);
      },
    };
    const result = await advanceRound(roundId, { ...engine, store });
    expect(done).toBe(true);
    return result;
  }

  it("AC-9: a move while its failure is handled is a quiet stop", async () => {
    const u = await newUser();
    const r = await failedRound(u, { told: true });
    await held.pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    expect(await advanceMoving(r.roundId, 0, "release")).toBe("advanced");
    quiet();
  });

  it("AC-9: a move as its deadline closes it sends nothing and doesn't alert that it's held open", async () => {
    const u = await newUser();
    const r = await failedRound(u, { deadlineIn: 1, told: true });
    await held.pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    const before = texts(u).length;
    expect(await advanceMoving(r.roundId, 2, "holdsLease")).toBe("advanced");
    quiet();
    expect(named("round_deadline_email_held_open")).toEqual([]);
    expect(texts(u)).toHaveLength(before);
    expect(await sends(r.roundId)).not.toContain("skipped");
  });

  it("AC-2: nothing in it can be replaced, and the fix page looks nothing up", async () => {
    const u = await newUser();
    const r = await failedRound(u, { told: true });
    await move(r.roundId);
    const deps = { ...wiring(dayAt(0)).purchase, zincKey: "zn_test_app", taxPct: 8 } as unknown as Parameters<typeof quoteFailedOrder>[1] & Parameters<typeof replaceFailedOrder>[1];
    held.zinc.calls = [];
    expect(["not_open", "not_current"]).toContain(await quoteFailedOrder({ userId: u.userId, roundId: r.roundId, orderId: r.orderId }, deps));
    expect(held.zinc.calls).toEqual([]);
    const replaced = await replaceFailedOrder({ userId: u.userId, roundId: r.roundId, failedOrderId: r.orderId, ideaId: r.ideaIds[0], shownTotalCents: 4200 }, deps);
    expect(replaced.ok).toBe(false);
    expect((await held.pg.query("select count(*)::int as n from concierge.orders where round_id = $1", [r.roundId])).rows[0].n).toBe(1);
  });

  it("AC-2: the late email for an untold failure says the date changed, not to buy something else", async () => {
    const u = await newUser();
    const r = await failedRound(u, { type: "out_of_stock" });
    await move(r.roundId);
    await tellOrdered(r.roundId, wiring(dayAt(0)).engine);
    const text = texts(u).at(-1)!;
    expect(text).toContain("The store ran out.");
    expect(text).toContain("What happens next: the date changed, so this round ended and nothing more is bought for it. If there's time before the new date, we'll send new ideas.");
    expect(text).not.toContain("pick something up yourself");
  });

  it("AC-2: the daily news tells a store cancel on it the same way", async () => {
    const u = await newUser();
    const r = await failedRound(u, { type: "store_cancelled" });
    await held.pg.query("update concierge.orders set refund_cents = 3450 where id = $1", [r.orderId]);
    await move(r.roundId);
    await runTrackingNews({
      store: createSupabaseRoundStore(ownStaleOrders(held.client(), [u.userId])),
      notify: wiring(dayAt(0)).engine.notify,
      today: addDays(held.today, 0),
      setting: async () => 1,
    });
    const text = texts(u).at(-1)!;
    expect(text).toContain("The $34.50 is back in your Zinc wallet.");
    expect(text).toContain("the date changed, so this round ended");
    expect(text).not.toContain("too late for us to ship");
  });

  // ─── what saving a moved date reads (giftsAround) ───

  describe("giftsAround, as the signed-in buyer", () => {
    async function signIn(paid = true) {
      const email = `moved-${crypto.randomUUID()}@example.test`;
      const password = "local-only-password";
      const s = stack!.supabase!;
      const admin = held.client();
      const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error) throw made.error;
      held.users.push(made.data.user.id);
      await held.pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, $2)", [made.data.user.id, paid]);
      const db = createClient<Database>(s.url, s.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await db.auth.signInWithPassword({ email, password });
      if (signed.error) throw signed.error;
      return { u: { userId: made.data.user.id, email } as User, db };
    }
    /** A round with one order in `status`, its occasion `n` days from today. */
    async function withOrder(u: User, status: string, n = 40) {
      const r = await newRound(u);
      const occasion = await occasionOf(r.roundId);
      await held.pg.query("update concierge.gift_rounds set occasion_date = $2 where id = $1", [r.roundId, addDays(held.today, n)]);
      await held.pg.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, failure_type, ship_to, ship_city, ship_state)
         values ($1, $2, $3, 'zinc_wallet', 4500, 100, $4, $5, $6, 'recipient', 'Dayton', 'OH')`,
        [u.userId, r.roundId, r.ideaIds[0], status, status === "held" ? "funds" : null, status === "failed" ? "price_up" : null],
      );
      return occasion;
    }
    const around = (occasion: string) => createSupabasePeopleStore().giftsAround(occasion, held.today);

    it.each(["held", "placing", "unconfirmed", "placed", "shipped"])("a %s gift is set for its date", async (status) => {
      const { u, db } = await signIn();
      current = db;
      expect(await around(await withOrder(u, status))).toEqual({ setFor: addDays(held.today, 40), given: [], paid: true });
    });

    it.each(["failed", "cancelled", "refunded"])("a %s one isn't", async (status) => {
      const { u, db } = await signIn();
      current = db;
      expect(await around(await withOrder(u, status))).toEqual({ setFor: null, given: [], paid: true });
    });

    it("a delivered gift was given; one still on its way for a past date isn't set", async () => {
      const { u, db } = await signIn();
      current = db;
      expect(await around(await withOrder(u, "delivered", -3))).toEqual({ setFor: null, given: [addDays(held.today, -3)], paid: true });
      expect(await around(await withOrder(u, "shipped", -3))).toEqual({ setFor: null, given: [], paid: true });
    });

    it("unpaid, someone else's gift, and the switch", async () => {
      const unpaid = await signIn(false);
      const occasion = await withOrder(unpaid.u, "placed");
      current = unpaid.db;
      expect(await around(occasion)).toEqual({ setFor: addDays(held.today, 40), given: [], paid: false });
      current = (await signIn()).db;
      expect(await around(occasion)).toEqual({ setFor: null, given: [], paid: true });
      await held.pg.query("update concierge.app_settings set value = '0' where key = 'moved_dates_close_rounds'");
      expect(await around(occasion)).toBeNull();
    });
  });
});
