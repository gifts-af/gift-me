// Placing card orders and sweeping them (Zinc Connect): our database is real (local Supabase,
// E5), only Zinc is faked. Every request made with the app's Zinc key is checked after each test:
// a create without the card payment would be paid from the shared Zinc account's wallet.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack, ownStaleOrders } from "../../../test/local-db";
import { approveAndBuy } from "../purchase/approve";
import { placeHeldForUser, sweepStalePlacing } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import { readHoldGate } from "../rounds/hold-gate";
import { createSupabaseRoundStore } from "../rounds/store";
import { connectKey } from "../zinc/orders";
import { FakeZinc } from "./fake-zinc";

vi.mock("server-only", () => ({}));

const stack = await localStack({ api: true });
const supabase = stack?.supabase ?? null;

const APP_KEY = `zn_test_app_${randomUUID()}`;
const SWITCHES = ["zinc_ordering_enabled", "connect_enabled"];

describe.skipIf(!stack)("placing and sweeping card orders (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  let was: { key: string; value: string }[];
  let log: MockInstance<typeof console.log>;
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => "advanced");

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
    await setSwitch("zinc_ordering_enabled", true);
    await setSwitch("connect_enabled", true);
    zinc = new FakeZinc((key) => key === APP_KEY || users.some((u) => key === `zn_test_${u}`));
    advanceRound.mockClear();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    // Every order created with the app key carried the card payment (the shared wallet never pays).
    for (const r of zinc.requests.filter((x) => x.key === APP_KEY && x.method === "POST")) {
      expect(r.path).toBe("/orders");
      expect(r.body?.payment).toMatchObject({ mode: "connect", payment_method: expect.stringMatching(/^pm_/), customer: expect.stringMatching(/^cus_/) });
      expect(r.body?.payment).toHaveProperty("margin.type", "flat");
    }
    log.mockRestore();
  });

  const setSwitch = (key: string, on: boolean) => pg.query("update concierge.app_settings set value = $1 where key = $2", [on ? "1" : "0", key]);
  const events = (name: string) =>
    log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => e.event === name);

  const db = () => ownStaleOrders(createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } }), users);
  const deps = (over: Partial<PurchaseDeps> = {}): PurchaseDeps => ({
    db: db(),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
    env: "test",
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
    settings: { feeCents: 100, marginPct: 10 },
    advanceRound,
    sleep: async () => {},
    clock: () => 0,
    connectKey: connectKey(APP_KEY),
    ...over,
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function newUser(card: boolean): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, `card-placing-${id}@example.com`],
    );
    if (card) {
      await pg.query(
        `insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode, stripe_customer_id, stripe_payment_method_id)
         values ($1, true, '5555550100', 'connect', $2, $3)`,
        [id, `cus_${id}`, `pm_${id}`],
      );
    } else {
      await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode) values ($1, true, '5555550100', 'zinc_wallet')", [id]);
      await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [id, `zn_test_${id}`, `zn_whsec_${randomUUID()}`, randomUUID()]);
    }
    return id;
  }

  /** A round with one idea per goods total (a wallet total is goods plus the $1 fee). */
  async function newRound(userId: string, goods: number[] = [2259]): Promise<{ roundId: string; ideaIds: string[] }> {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, person.rows[0].id]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 20000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [userId, person.rows[0].id, occasion.rows[0].id],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    for (const [i, g] of goods.entries()) {
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, price_cents, est_total_cents, goods_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source)
         values ($1, $2, 'Gift', 'https://shop.test/pending', $3, $4, $3, 2, 3, 5, $5, 'generated') returning id`,
        [userId, roundId, g, g + 100, i + 1],
      );
      const id = idea.rows[0].id as string;
      await pg.query("update concierge.gift_ideas set product_url = $2 where id = $1", [id, urlOf(id)]);
      ideaIds.push(id);
    }
    return { roundId, ideaIds };
  }
  const urlOf = (ideaId: string) => `https://shop.test/p/${ideaId}`;
  const buy = (userId: string, r: { roundId: string; ideaIds: string[] }, over: Partial<PurchaseDeps> = {}) =>
    approveAndBuy({ userId, roundId: r.roundId, ideaIds: r.ideaIds, shownMaxCents: 1_000_000 }, deps(over));

  /** Approved through the real approval (with the placing switched off), then left held to place later. */
  async function approvedOnly(userId: string, r: { roundId: string; ideaIds: string[] }) {
    await setSwitch("zinc_ordering_enabled", false);
    expect(await buy(userId, r)).toMatchObject({ ok: true });
    await setSwitch("zinc_ordering_enabled", true);
    zinc.requests = [];
    zinc.posts = [];
  }

  const orders = async (roundId: string) =>
    (
      await pg.query(
        `select o.id, o.status, o.hold_reason, o.failure_type, o.provider_order_id, o.max_price_cents, o.max_charge_cents, o.margin_cents,
                o.payment_method_id, o.total_cents, o.fee_cents, o.final_charge_cents, o.idempotency_key::text as idem
           from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
          where o.round_id = $1 order by i.rank, o.created_at, o.id`,
        [roundId],
      )
    ).rows;
  const card = async (userId: string) =>
    (await pg.query("select stripe_payment_method_id as pm from concierge.accounts where user_id = $1", [userId])).rows[0].pm as string | null;
  const roundRow = async (roundId: string) =>
    (await pg.query("select status::text as status, attention_reason from concierge.gift_rounds where id = $1", [roundId])).rows[0];
  const later = () => new Date(Date.now() + 24 * 60 * 60_000);

  // ─── placing ──────────────────────────────────────────────────────────────

  it("a card order goes held → placing → placed through the real SQL, with the exact payment, its card and saved margin (AC-3)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    expect(await buy(u, r)).toMatchObject({ ok: true });
    const [o] = await orders(r.roundId);
    expect(o).toMatchObject({ status: "placing", payment_method_id: `pm_${u}` });
    expect(o.provider_order_id).toMatch(/^zn_/);
    expect(zinc.posts).toHaveLength(1);
    const post = zinc.posts[0];
    expect(post.key).toBe(APP_KEY);
    expect(post.body.payment).toEqual({ mode: "connect", payment_method: `pm_${u}`, customer: `cus_${u}`, margin: { type: "flat", value: o.margin_cents } });
    // max_price is the goods cap only.
    expect(post.maxPrice).toBe(o.max_price_cents);
    expect(o.max_charge_cents).toBeGreaterThan(o.max_price_cents);

    // Zinc placed it and reports its charge: the sweep settles it on the app key.
    zinc.orders.set(o.id, {
      id: o.provider_order_id,
      status: "order_placed",
      job_result: { success: true, price_components: { subtotal: 2100, shipping: 0, tax: 159, total: 2259 } },
      connect: { state: "captured", final_charge: 2564 },
    });
    const orderPlaced = vi.fn(async () => {});
    expect(await sweepStalePlacing(deps({ now: later(), orderPlaced }))).toBeGreaterThanOrEqual(1);
    expect(zinc.requests.filter((x) => x.method === "GET").every((x) => x.key === APP_KEY)).toBe(true);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "placed", total_cents: 2259, final_charge_cents: 2564, fee_cents: 305 });
    expect(orderPlaced).toHaveBeenCalledWith(r.roundId);
    expect(events("order.over_max_charge")).toEqual([]);
    // What the ordered email is built from, read by the real round store.
    const ctx = await createSupabaseRoundStore(db()).roundContext(r.roundId);
    expect(ctx.orders[0]).toMatchObject({ fundingMode: "connect", totalCents: 2259, feeCents: 305, finalChargeCents: 2564 });
  });

  it("a wallet order's request body is unchanged: no payment, the buyer's own key (AC-16)", async () => {
    const u = await newUser(false);
    const r = await newRound(u);
    expect(await approveAndBuy({ userId: u, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toMatchObject({ ok: true });
    expect(zinc.posts).toHaveLength(1);
    expect(zinc.posts[0].key).toBe(`zn_test_${u}`);
    expect(Object.keys(zinc.posts[0].body).sort()).toEqual(
      ["fulfillment", "idempotency_key", "is_gift", "max_price", "metadata", "products", "shipping_address"].sort(),
    );
    expect(zinc.requests.some((x) => x.key === APP_KEY)).toBe(false);
  });

  it.each([
    ["a listed card code", "payment_failed", "card_needed", true],
    ["an unlisted 402", "something_new", "failed", false],
    ["the store refusing payment", "payment_declined", "failed", false],
  ])("a 402 with %s never becomes funds (AC-6)", async (_label, code, failure, cleared) => {
    const u = await newUser(true);
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 402, code }]);
    await buy(u, r);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: failure });
    expect(await card(u)).toBe(cleared ? null : `pm_${u}`);
    expect((await roundRow(r.roundId)).attention_reason).not.toBe("funds");
    expect(zinc.posts).toHaveLength(1);
  });

  it("two gifts, the first declined: exactly one POST, and the second ends card_needed too (AC-6)", async () => {
    const u = await newUser(true);
    const r = await newRound(u, [2259, 1500]);
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 402, code: "payment_failed" }]);
    await buy(u, r);
    expect(zinc.posts).toHaveLength(1);
    expect((await orders(r.roundId)).map((o) => [o.status, o.failure_type])).toEqual([
      ["failed", "card_needed"],
      ["failed", "card_needed"],
    ]);
    expect(await card(u)).toBeNull();
    // The card_needed email says to add a card: none is saved now.
    expect(await createSupabaseRoundStore(db()).roundContext(r.roundId)).toMatchObject({ hasCard: false });
    await pg.query("update concierge.accounts set stripe_payment_method_id = $2 where user_id = $1", [u, `pm_new_${u}`]);
    expect(await createSupabaseRoundStore(db()).roundContext(r.roundId)).toMatchObject({ hasCard: true });
  });

  it("an order Zinc already has as declined (found after a 409) ends card_needed and clears the card", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    await approvedOnly(u, r);
    const [o] = await orders(r.roundId);
    zinc.orders.set(o.id, { id: "zn_old", status: "order_failed", job_result: { success: false, error_type: "invalid_payment_method" } });
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 409, code: "already_exists" }]);
    await placeHeldForUser(u, deps());
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "card_needed" });
    expect(await card(u)).toBeNull();
  });

  it("a decline after a timeout stays placing for the sweep (T56); the sweep then finds it declined and clears the card", async () => {
    const u = await newUser(true);
    const r = await newRound(u, [2259, 1500]);
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout", { status: 402, code: "payment_failed" }]);
    await buy(u, r);
    const [a, b] = await orders(r.roundId);
    expect(a.status).toBe("placing");
    expect(b).toMatchObject({ status: "held", hold_reason: "retry" });
    expect(await card(u)).toBe(`pm_${u}`);

    zinc.orders.set(a.id, { id: "zn_late", status: "order_failed", job_result: { success: false, error_type: "payment_failed" } });
    await sweepStalePlacing(deps({ now: later() }));
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "card_needed" });
    expect(await card(u)).toBeNull();
  });

  it("a resend sends the order's recorded card even after the buyer replaced theirs (AC-13)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout", "ok"]);
    const sleep = async () => {
      await pg.query("update concierge.accounts set stripe_payment_method_id = 'pm_replaced' where user_id = $1", [u]);
    };
    await buy(u, r, { sleep });
    expect(zinc.posts.length).toBeGreaterThanOrEqual(2);
    expect(zinc.posts.map((p) => (p.body.payment as { payment_method: string }).payment_method)).toEqual(zinc.posts.map(() => `pm_${u}`));
  });

  it("the app key refused (401) holds the round paused, alerts the owner, and asks the buyer nothing (AC-19)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    await buy(u, r, { connectKey: connectKey("zn_test_revoked") });
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "held", hold_reason: "paused" });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "paused" });
    expect(events("zinc.connect_unauthorized")).toEqual([expect.objectContaining({ round_id: r.roundId, alert: true })]);
    expect(events("zinc.unauthorized")).toEqual([]);
  });

  it.each(["card_verification_required", "stripe_error", "payment_method_required", "payment_missing", "app_key_missing"])(
    "Zinc's %s is about our account, not the buyer's card: the round is held paused, the card kept, the owner alerted (AC-19)",
    async (code) => {
      const u = await newUser(true);
      const r = await newRound(u, [2259, 1500]);
      zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 402, code }]);
      await buy(u, r);
      expect(zinc.posts).toHaveLength(1);
      const after = await orders(r.roundId);
      expect(after.map((o) => [o.status, o.hold_reason, o.failure_type])).toEqual([
        ["held", "paused", null],
        ["held", "paused", null],
      ]);
      // A fresh key, so once the account is fixed Zinc can't answer the retry with its stored refusal.
      expect(after[0].idem).not.toBe(zinc.posts[0].idem);
      expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "paused" });
      expect(await card(u)).toBe(`pm_${u}`);
      expect(events("zinc.connect_unauthorized")).toEqual([expect.objectContaining({ round_id: r.roundId, reason: "account", code, alert: true })]);
      expect(advanceRound).not.toHaveBeenCalled();
    },
  );

  it("a key handle we didn't make is refused before any request (app_key_missing) and held paused", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    await buy(u, r, { connectKey: Object.freeze({ kind: "zinc_connect_key" as const }) });
    expect(zinc.requests).toEqual([]);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "held", hold_reason: "paused" });
    expect(await card(u)).toBe(`pm_${u}`);
    expect(events("zinc.connect_unauthorized")).toEqual([expect.objectContaining({ reason: "account", code: "app_key_missing", alert: true })]);
  });

  it("an order Zinc already has failed for our account (found after a 409) ends failed, keeps the card and pauses the rest", async () => {
    const u = await newUser(true);
    const r = await newRound(u, [2259, 1500]);
    await approvedOnly(u, r);
    const [o] = await orders(r.roundId);
    zinc.orders.set(o.id, { id: "zn_old", status: "order_failed", job_result: { success: false, error_type: "card_verification_required" } });
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 409, code: "already_exists" }]);
    await placeHeldForUser(u, deps());
    expect((await orders(r.roundId)).map((x) => [x.status, x.hold_reason, x.failure_type])).toEqual([
      ["failed", null, "failed"],
      ["held", "paused", null],
    ]);
    expect(await card(u)).toBe(`pm_${u}`);
    expect(events("zinc.connect_unauthorized")).toEqual([expect.objectContaining({ reason: "account", code: "card_verification_required", alert: true })]);
  });

  it("no app key here holds the round paused with the same alert, and calls Zinc not at all (AC-19)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    await buy(u, r, { connectKey: null });
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "held", hold_reason: "paused" });
    expect(events("zinc.connect_unauthorized")).toEqual([expect.objectContaining({ round_id: r.roundId, alert: true })]);
    expect(zinc.requests).toEqual([]);
  });

  it("card payments switched off: nothing is placed, and the hold reads paused (AC-12)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    await approvedOnly(u, r);
    await setSwitch("connect_enabled", false);
    await placeHeldForUser(u, deps());
    expect(zinc.requests).toEqual([]);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "held", hold_reason: "paused" });
  });

  it("never reads a card buyer's Zinc wallet before placing", async () => {
    const u = await newUser(true);
    await pg.query("update concierge.accounts set auto_topup_on = false where user_id = $1", [u]);
    const r = await newRound(u);
    await buy(u, r);
    expect(zinc.calls).not.toContain("GET /wallet/me");
    expect(zinc.posts).toHaveLength(1);
  });

  // ─── the sweep ────────────────────────────────────────────────────────────

  it("the sweep looks a card order up with the app key and a wallet order with the buyer's (AC-7)", async () => {
    const [cu, wu] = [await newUser(true), await newUser(false)];
    const [cr, wr] = [await newRound(cu), await newRound(wu)];
    zinc.plan.set(urlOf(cr.ideaIds[0]), ["timeout"]);
    zinc.plan.set(urlOf(wr.ideaIds[0]), ["timeout"]);
    await buy(cu, cr);
    await approveAndBuy({ userId: wu, roundId: wr.roundId, ideaIds: wr.ideaIds }, deps());
    const [co, wo] = [(await orders(cr.roundId))[0], (await orders(wr.roundId))[0]];
    expect([co.status, wo.status]).toEqual(["placing", "placing"]);
    zinc.requests = [];
    await sweepStalePlacing(deps({ now: later() }));
    const lookups = zinc.requests.filter((x) => x.method === "GET" && x.path === "/orders");
    expect(lookups.filter((x) => x.ref === co.id).map((x) => x.key)).toEqual([APP_KEY]);
    expect(lookups.filter((x) => x.ref === wo.id).map((x) => x.key)).toEqual([`zn_test_${wu}`]);
    // Neither was found: both are unconfirmed for the owner, and nothing was resent.
    expect(zinc.requests.filter((x) => x.method === "POST")).toEqual([]);
  });

  it("the sweep finding a card order failed for our own Zinc account ends it failed, keeps the card and alerts the owner", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout"]);
    await buy(u, r);
    const [o] = await orders(r.roundId);
    zinc.orders.set(o.id, { id: "zn_acct", status: "order_failed", job_result: { success: false, error_type: "card_verification_required" } });
    await sweepStalePlacing(deps({ now: later() }));
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "failed" });
    expect(await card(u)).toBe(`pm_${u}`);
    expect(events("zinc.connect_unauthorized")).toEqual([
      expect.objectContaining({ order_id: o.id, reason: "account", code: "card_verification_required", alert: true }),
    ]);
  });

  it("Zinc charging more than the approved maximum alerts the owner (AC-4)", async () => {
    const u = await newUser(true);
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout"]);
    await buy(u, r);
    const [o] = await orders(r.roundId);
    zinc.orders.set(o.id, {
      id: "zn_over",
      status: "order_placed",
      job_result: { success: true, price_components: { total: 2259 } },
      connect: { final_charge: o.max_charge_cents + 1 },
    });
    await sweepStalePlacing(deps({ now: later() }));
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "placed", final_charge_cents: o.max_charge_cents + 1 });
    expect(events("order.over_max_charge")).toEqual([
      expect.objectContaining({ order_id: o.id, charge_cents: o.max_charge_cents + 1, max_charge_cents: o.max_charge_cents, alert: true }),
    ]);
  });

  // ─── wallet-only steps skip card buyers ───────────────────────────────────

  it("the low-balance warning and the hold's setup check go by a saved card, not a Zinc wallet", async () => {
    const u = await newUser(true);
    const admin = createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } });
    expect(await createSupabaseRoundStore(admin).canBuy(u)).toBe(false);
    expect(await readHoldGate(admin, u, { adminDb: admin, zincEnv: "test" })).toEqual({ orderingOn: true, paid: true, setUp: true });
    await pg.query("update concierge.accounts set stripe_payment_method_id = null where user_id = $1", [u]);
    expect((await readHoldGate(admin, u, { adminDb: admin, zincEnv: "test" })).setUp).toBe(false);
    await setSwitch("connect_enabled", false);
    expect((await readHoldGate(admin, u, { adminDb: admin, zincEnv: "test" })).orderingOn).toBe(false);
    // A wallet buyer is judged as before.
    const w = await newUser(false);
    expect(await createSupabaseRoundStore(admin).canBuy(w)).toBe(true);
    expect(await readHoldGate(admin, w, { adminDb: admin, zincEnv: "test" })).toEqual({ orderingOn: true, paid: true, setUp: true });
  });
});
