// @vitest-environment node
// Approve, place, sweep (ALL-32 Task 6, ALL-30: AC-15 to AC-21, AC-26, AC-28). Our own
// database is real (local Supabase, E5); only Zinc is faked. Skipped when the local
// database isn't running. The kill switch is a shared setting: tests that flip it put it back.
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { localSupabase } from "../../../e2e/local-supabase";
import { approveAndBuy } from "../purchase/approve";
import { placeHeldForUser, placeRound, sweepStalePlacing } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import { handleZincWebhook } from "../zinc/events";
import { FakeZinc } from "./fake-zinc";

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

describe.skipIf(!dbUp)("approve, place and sweep (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  let killSwitchBefore: string;
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => "advanced");

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    killSwitchBefore = (await pg.query("select value from concierge.app_settings where key = 'zinc_ordering_enabled'")).rows[0].value;
    await setSwitch(true);
  });
  afterAll(async () => {
    await pg.query("update concierge.app_settings set value = $1 where key = 'zinc_ordering_enabled'", [killSwitchBefore]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    // Another test file (placing-race) also sets and restores this shared switch.
    await setSwitch(true);
    zinc = new FakeZinc((key) => users.some((u) => key === `zn_test_${u}`));
    advanceRound.mockClear();
  });

  const setSwitch = (on: boolean) =>
    pg.query("update concierge.app_settings set value = $1 where key = 'zinc_ordering_enabled'", [on ? "1" : "0"]);

  const deps = (over: Partial<PurchaseDeps> = {}): PurchaseDeps => ({
    db: createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } }),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
    env: "test",
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
    settings: { feeCents: 100, marginPct: 10 },
    advanceRound,
    sleep: async () => {},
    clock: () => 0,
    ...over,
  });

  /** Our real database, with one named function failing for one round, like a dropped connection would. */
  function failingRpc(name: string, roundId: string) {
    const real = createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } });
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "schema") return Reflect.get(target, prop, receiver);
        return (schema: "concierge") => {
          const s = target.schema(schema);
          return new Proxy(s, {
            get(t, p, r) {
              if (p !== "rpc") return Reflect.get(t, p, r);
              return (fn: string, args: Record<string, unknown>) =>
                fn === name && args?.p_round_id === roundId
                  ? Promise.resolve({ data: null, error: { code: "XX000", message: "down" } })
                  : (t.rpc as (f: string, a: unknown) => unknown).call(t, fn, args);
            },
          });
        };
      },
    });
  }

  // ─── fixtures ─────────────────────────────────────────────────────────────

  type User = { userId: string; webhookId: string; secret: string };
  async function newUser(o: { paid?: boolean; connected?: boolean; env?: "test" | "live"; autoTopUp?: boolean | null } = {}): Promise<User> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `purchase-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, auto_topup_on) values ($1, $2, '5555550100', $3)", [
      userId,
      o.paid ?? true,
      o.autoTopUp ?? null,
    ]);
    const webhookId = randomUUID();
    const secret = `zn_whsec_${randomUUID()}`;
    if (o.connected ?? true) {
      await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, $5)", [userId, `zn_test_${userId}`, secret, webhookId, o.env ?? "test"]);
    }
    return { userId, webhookId, secret };
  }

  type Round = { roundId: string; personId: string; occasionId: string; ideaIds: string[] };
  async function newRound(
    u: User,
    o: { budget?: number | null; totals?: number[]; listItems?: (string | null)[]; deadlineIn?: number } = {},
  ): Promise<Round> {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [u.userId],
    );
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.userId,
      person.rows[0].id,
    ]);
    const deadlineIn = o.deadlineIn ?? 30;
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + $4::int + 7, current_date + $4::int, $5, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [u.userId, person.rows[0].id, occasion.rows[0].id, deadlineIn, o.budget === undefined ? 10000 : o.budget],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    for (const [i, total] of (o.totals ?? [4200]).entries()) {
      const item = o.listItems?.[i] ?? null;
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, list_item_id)
         values ($1, $2, 'Gift', 'https://shop.test/pending', $3, $3, 2, 3, 5, $4, $5, $6) returning id`,
        [u.userId, roundId, total, i + 1, item ? "list" : "generated", item],
      );
      const id = idea.rows[0].id as string;
      await pg.query("update concierge.gift_ideas set product_url = $2 where id = $1", [id, urlOf(id)]);
      ideaIds.push(id);
    }
    return { roundId, personId: person.rows[0].id, occasionId: occasion.rows[0].id, ideaIds };
  }
  const urlOf = (ideaId: string) => `https://shop.test/p/${ideaId}`;

  /** Approved the way approveAndBuy does it, then "crashed" before placing: held/retry, lease given back. */
  async function approvedOnly(u: User, r: Round, cap = 4520): Promise<void> {
    const claimed = await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId]);
    const lock = claimed.rows[0].locked_until;
    const orders = r.ideaIds.map((id) => ({
      idea_id: id,
      max_price_cents: cap,
      fee_cents: 100,
      ship_to: "recipient",
      address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
    }));
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [r.roundId, u.userId, lock, JSON.stringify(orders)]);
    await pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
  }

  const orders = async (roundId: string) =>
    (
      await pg.query(
        `select o.id, o.idea_id, o.status, o.hold_reason, o.failure_type, o.resolved, o.max_price_cents, o.provider_order_id, o.total_cents,
                o.idempotency_key::text as idem
           from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
          where o.round_id = $1 order by i.rank, o.created_at, o.id`,
        [roundId],
      )
    ).rows;
  const round = async (roundId: string) =>
    (
      await pg.query(
        "select status::text as status, attention_reason, seen_balance_cents, locked_until, next_action_at <= now() as due from concierge.gift_rounds where id = $1",
        [roundId],
      )
    ).rows[0];

  // ─── approve ──────────────────────────────────────────────────────────────

  it("approves, caps the order at the pick plus the margin less the fee (4520), and sends it (AC-15, AC-16, AC-18)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const result = await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds, giftMessage: "Happy holidays" }, deps());
    expect(result).toEqual({ ok: true, status: "ordered", reason: null });
    const [o] = await orders(r.roundId);
    expect(o).toMatchObject({ status: "placing", max_price_cents: 4520 });
    expect(o.provider_order_id).toMatch(/^zn_/);
    expect(zinc.posts).toEqual([expect.objectContaining({ ref: o.id, idem: o.idem, maxPrice: 4520, url: urlOf(r.ideaIds[0]), city: "Dayton" })]);
    expect(zinc.posts[0].key).toBe(`zn_test_${u.userId}`);
    expect(await round(r.roundId)).toMatchObject({ status: "ordered", attention_reason: null, locked_until: null });
    expect(advanceRound).not.toHaveBeenCalled();
  });

  it("splits a budget between two picks so the caps and fees never pass it (AC-15)", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [4200, 5000] });
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    const [a, b] = await orders(r.roundId);
    expect(a.max_price_cents).toBe(4520);
    expect(b.max_price_cents).toBe(5280);
    expect(a.max_price_cents + b.max_price_cents + 200).toBeLessThanOrEqual(10000);
  });

  it("refuses a pair past the over-budget limit", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [6000, 6000] });
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds, overBudgetConfirmed: true }, deps())).toEqual({
      ok: false,
      error: "over_budget",
    });
    expect(await orders(r.roundId)).toHaveLength(0);
  });

  it("refuses an over-budget pair unless confirmed, and refuses without paid features, writing nothing", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [6000, 5000] });
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: false, error: "needs_confirmation" });
    expect(await orders(r.roundId)).toHaveLength(0);
    expect((await round(r.roundId)).locked_until).toBeNull();
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds, overBudgetConfirmed: true }, deps())).toEqual({
      ok: true,
      status: "ordered",
      reason: null,
    });

    const v = await newUser({ paid: false });
    const s = await newRound(v);
    expect(await approveAndBuy({ userId: v.userId, roundId: s.roundId, ideaIds: s.ideaIds }, deps())).toEqual({ ok: false, error: "not_allowed" });
    expect(await orders(s.roundId)).toHaveLength(0);
    expect(zinc.posts.filter((p) => p.key.endsWith(v.userId))).toHaveLength(0);
  });

  it("a double approve gets busy, and only one set of orders exists (AC-18)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    let open!: () => void;
    zinc.gate = new Promise<void>((res) => (open = res));
    const posted = new Promise<void>((res) => (zinc.onPost = res));
    const first = approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    await posted;
    const second = await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    open();
    expect(second).toEqual({ ok: false, error: "busy" });
    expect(await first).toEqual({ ok: true, status: "ordered", reason: null });
    expect(await orders(r.roundId)).toHaveLength(1);
    expect(zinc.posts).toHaveLength(1);
    // Approving again once it's done is refused, not a second order.
    expect((await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).ok).toBe(false);
    expect(await orders(r.roundId)).toHaveLength(1);
  });

  it("claims a list pick at approval, and refuses one someone else already claimed (AC-28)", async () => {
    const u = await newUser();
    const owner = await newUser();
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id", [owner.userId]);
    const item = await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Vase', 4000) returning id", [list.rows[0].id]);
    const taken = await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 1, 'Lamp', 4000) returning id", [list.rows[0].id]);
    await pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name) values ($1, $2, 'Bea')", [taken.rows[0].id, owner.userId]);

    const r = await newRound(u, { listItems: [item.rows[0].id] });
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "ordered", reason: null });
    const claim = await pg.query("select claimer_id, for_order from lists.gift_claims where item_id = $1", [item.rows[0].id]);
    expect(claim.rows[0]).toEqual({ claimer_id: u.userId, for_order: true });

    const s = await newRound(u, { listItems: [taken.rows[0].id] });
    expect(await approveAndBuy({ userId: u.userId, roundId: s.roundId, ideaIds: s.ideaIds }, deps())).toEqual({ ok: false, error: "claimed" });
    expect(await orders(s.roundId)).toHaveLength(0);
    expect((await round(s.roundId)).locked_until).toBeNull();
  });

  // ─── the kill switch and the gates ────────────────────────────────────────

  it("with the switch off, holds as paused with no Zinc call and no email; switched on, the next placing sends it (AC-17)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await setSwitch(false);
    try {
      expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "paused" });
      expect(zinc.calls).toEqual([]);
      expect(advanceRound).not.toHaveBeenCalled();
      expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "paused", locked_until: null, due: false });
    } finally {
      await setSwitch(true);
    }
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toHaveLength(1);
    expect(await round(r.roundId)).toMatchObject({ status: "ordered" });
  });

  it("a key saved for the other Zinc environment is setup not finished: no Zinc call, and the buyer is told", async () => {
    const u = await newUser({ env: "live" });
    const r = await newRound(u);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "setup" });
    expect(zinc.calls).toEqual([]);
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "setup", due: true });
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
  });

  it("not connected is a setup hold, emailed through the engine", async () => {
    const u = await newUser({ connected: false });
    const r = await newRound(u);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "setup" });
    expect(zinc.calls).toEqual([]);
    expect((await round(r.roundId)).attention_reason).toBe("setup");
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
  });

  it("after a crash right after approving, the next placing sends it (review focus 6)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r);
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry" });
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toHaveLength(1);
    expect((await orders(r.roundId))[0].status).toBe("placing");
  });

  it.each([
    // Deleting the person or switching the occasion off closes the round (skip_open_rounds), cancelling the hold.
    ["the person is deleted", "update public.people set deleted_at = now() where id = $1", "person", "cancelled"],
    ["the occasion is switched off", "update concierge.occasions set enabled = false where id = $1", "occasion", "cancelled"],
    ["it is the deadline day", "update concierge.gift_rounds set ship_by_deadline = current_date where id = $1", "round", "held"],
  ] as const)("sends nothing when %s (AC-21)", async (_label, sql, target, after) => {
    const u = await newUser({ autoTopUp: false });
    const r = await newRound(u);
    await approvedOnly(u, r);
    await pg.query(sql, [target === "person" ? r.personId : target === "occasion" ? r.occasionId : r.roundId]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
    expect((await orders(r.roundId))[0].status).toBe(after);
  });

  it("paid features switched off holds as not_allowed with no Zinc call; back on, a gift that can no longer arrive in time is too_late, not sent", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r);
    await pg.query("update concierge.accounts set paid_features = false where user_id = $1", [u.userId]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "not_allowed" });

    await pg.query("update concierge.accounts set paid_features = true where user_id = $1", [u.userId]);
    await pg.query("update concierge.gift_ideas set delivery_days_max = 60 where id = $1", [r.ideaIds[0]]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "too_late", resolved: false });
    // The customer is told: the round asks for attention with the reason the engine emails.
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "too_late" });
  });

  it("no held rounds means no wallet call", async () => {
    const u = await newUser({ autoTopUp: false });
    await newRound(u);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
  });

  // ─── funds ────────────────────────────────────────────────────────────────

  it("auto top-up unknown and a 402: held for funds, with the balance Zinc reported (AC-20)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.balance = 1500;
    zinc.plan.set(urlOf(r.ideaIds[0]), ["402"]);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "funds" });
    expect(zinc.calls).not.toContain("GET /wallet/me");
    const [o] = await orders(r.roundId);
    expect(o).toMatchObject({ status: "held", hold_reason: "funds" });
    const rr = await round(r.roundId);
    expect(rr).toMatchObject({ status: "needs_attention", attention_reason: "funds", seen_balance_cents: 1500, due: true });
    // The shortfall the hold email shows: caps + fees − balance.
    expect(o.max_price_cents + 100 - rr.seen_balance_cents).toBe(3120);
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
    // A fresh key, so a cached 402 can't block the retry.
    expect(o.idem).not.toBe(zinc.posts[0].idem);
  });

  it("auto top-up known off and short: no POST, held for funds (AC-20)", async () => {
    const u = await newUser({ autoTopUp: false });
    const r = await newRound(u);
    zinc.balance = 4619;
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "funds" });
    expect(zinc.calls).toEqual(["GET /wallet/me"]);
    expect(await round(r.roundId)).toMatchObject({ attention_reason: "funds", seen_balance_cents: 4619 });

    // Exactly cap + fee is enough (review focus 7).
    zinc.balance = 4620;
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toHaveLength(1);
  });

  it("a 402 on the second pick leaves the first placed and holds the round for funds (review focus 2)", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [4200, 5000] });
    zinc.plan.set(urlOf(r.ideaIds[1]), ["402"]);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "funds" });
    const [a, b] = await orders(r.roundId);
    expect(a).toMatchObject({ status: "placing" });
    expect(a.provider_order_id).toMatch(/^zn_/);
    expect(b).toMatchObject({ status: "held", hold_reason: "funds" });
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
  });

  it("a re-try that still holds tells the buyer through the engine at once (Settings, address saved, top-up)", async () => {
    const u = await newUser({ autoTopUp: false });
    zinc.balance = 100;
    const r = await newRound(u);
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    advanceRound.mockClear();
    await placeHeldForUser(u.userId, deps());
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
  });

  // ─── timeouts and the sweep ───────────────────────────────────────────────

  it("a timeout keeps the order placing, the next pick unsent; the sweep settles it and the retry reuses the key (review focus 5)", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [4200, 5000] });
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout"]);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "held", reason: "retry" });
    const [a, b] = await orders(r.roundId);
    // Every quick retry used the same key; the second pick was never sent.
    expect(zinc.posts.map((p) => p.ref)).toEqual([a.id, a.id, a.id]);
    expect(new Set(zinc.posts.map((p) => p.idem))).toEqual(new Set([a.idem]));
    expect(a).toMatchObject({ status: "placing", provider_order_id: null });
    expect(b).toMatchObject({ status: "held", hold_reason: "retry" });
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry", due: false });
    expect(advanceRound).not.toHaveBeenCalled();

    // Zinc did create it after all.
    zinc.orders.set(a.id, {
      id: "zn_late",
      status: "order_placed",
      job_result: { success: true, price_components: { subtotal: 4000, shipping: 0, tax: 320, total: 4320, currency: "USD" } },
    });
    zinc.posts = [];
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toEqual([expect.objectContaining({ ref: b.id, idem: b.idem })]);

    const later = new Date(Date.now() + 31 * 60_000);
    const orderPlaced = vi.fn(async () => {});
    expect(await sweepStalePlacing(deps({ now: later, orderPlaced }))).toBeGreaterThanOrEqual(1);
    // The buyer gets the "ordered" email (ALL-32 Task 7).
    expect(orderPlaced).toHaveBeenCalledWith(r.roundId);
    const [a2] = await orders(r.roundId);
    // The price Zinc reports comes along, so the real total isn't lost.
    expect(a2).toMatchObject({ status: "placed", provider_order_id: "zn_late", total_cents: 4320 });
    expect(zinc.posts).toHaveLength(1);
  });

  it("the sweep tells the buyer about a failure at once, and a failing email never undoes a settlement", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout"]);
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    const [a] = await orders(r.roundId);
    zinc.orders.set(a.id, { id: "zn_gone", status: "failed", job_result: { success: false, error_type: "out_of_stock" } } as never);
    advanceRound.mockClear();
    const later = new Date(Date.now() + 31 * 60_000);
    await sweepStalePlacing(deps({ now: later }));
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);

    const v = await newRound(u);
    zinc.plan.set(urlOf(v.ideaIds[0]), ["timeout"]);
    await approveAndBuy({ userId: u.userId, roundId: v.roundId, ideaIds: v.ideaIds }, deps());
    const [b] = await orders(v.roundId);
    zinc.orders.set(b.id, { id: "zn_ok", status: "order_placed", job_result: { success: true } });
    const orderPlaced = vi.fn(async () => Promise.reject(new Error("email down")));
    expect(await sweepStalePlacing(deps({ now: later, orderPlaced }))).toBeGreaterThanOrEqual(1);
    expect((await orders(v.roundId))[0]).toMatchObject({ status: "placed" });
  });

  it("the sweep never resends: an order Zinc doesn't know is unconfirmed; one still processing is left alone", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [4200, 5000] });
    zinc.plan.set(urlOf(r.ideaIds[0]), ["timeout"]);
    zinc.plan.set(urlOf(r.ideaIds[1]), ["ok"]);
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    await placeHeldForUser(u.userId, deps());
    const [a, b] = await orders(r.roundId);
    expect(a.status).toBe("placing");
    expect(b.status).toBe("placing");
    zinc.posts = [];

    const later = new Date(Date.now() + 31 * 60_000);
    await sweepStalePlacing(deps({ now: later }));
    const [a2, b2] = await orders(r.roundId);
    expect(a2.status).toBe("unconfirmed");
    expect(b2.status).toBe("placing");
    expect(zinc.posts).toEqual([]);
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
  });

  // ─── caps, addresses, rejections ──────────────────────────────────────────

  it("the cap re-check after a budget raise stays at the saved cap, without throwing (AC-21)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r);
    await pg.query("update concierge.gift_rounds set budget_cents = 50000 where id = $1", [r.roundId]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toEqual([expect.objectContaining({ maxPrice: 4520 })]);
  });

  it("the cap re-check lowers a cap above what the round now allows (AC-21)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r, 9000);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toEqual([expect.objectContaining({ maxPrice: 4520 })]);
    expect((await orders(r.roundId))[0].max_price_cents).toBe(4520);
  });

  it("an address removed holds as address and sends nothing; a valid one saved, it ships there (AC-21)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r);
    await pg.query("update public.people set address_line1 = null, city = null where id = $1", [r.personId]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "address", due: true });

    await pg.query("update public.people set address_line1 = '9 Elm St', city = 'Columbus' where id = $1", [r.personId]);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toEqual([expect.objectContaining({ city: "Columbus" })]);
    const snap = await pg.query("select address_line1, city from concierge.order_addresses where order_id = $1", [(await orders(r.roundId))[0].id]);
    expect(snap.rows[0]).toEqual({ address_line1: "9 Elm St", city: "Columbus" });
  });

  it("fix_address from a webhook, then the address saved: the replacement is placed (AC-26)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    const [first] = await orders(r.roundId);
    const body = JSON.stringify({ event: "order.failed", order_id: first.provider_order_id, data: { error_type: "invalid_shipping_address" } });
    const sig = createHmac("sha256", u.secret).update(body).digest("hex");
    expect(await handleZincWebhook(u.webhookId, body, sig, { ...deps(), placeHeld: async () => {} })).toEqual({ status: 200 });
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "address" });

    await pg.query("update public.people set address_line1 = '9 Elm St' where id = $1", [r.personId]);
    zinc.posts = [];
    await placeHeldForUser(u.userId, deps());
    const [, replacement] = await orders(r.roundId);
    expect(replacement.status).toBe("placing");
    expect(zinc.posts).toEqual([expect.objectContaining({ ref: replacement.id, idem: replacement.idem })]);
    expect(replacement.idem).not.toBe(first.idem);
  });

  it("a synchronous 4xx fails the order as rejected", async () => {
    const u = await newUser();
    const r = await newRound(u);
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 400, code: "invalid_product" }]);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({ ok: true, status: "failed", reason: "failed" });
    expect(zinc.posts).toHaveLength(1);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "failed" });
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "failed" });
    // The customer is always told about a failure too.
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
  });

  it("a gift that can't arrive in time at approval is too_late, not sent, and the buyer is told", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await pg.query("update concierge.gift_ideas set delivery_days_max = 60 where id = $1", [r.ideaIds[0]]);
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toEqual({
      ok: true,
      status: "failed",
      reason: "too_late",
    });
    expect(zinc.calls).toEqual([]);
    expect(advanceRound).toHaveBeenCalledWith(r.roundId);
  });

  it("with no delivery range saved, the schedule's worst case decides: too late near the date is never sent", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: 1 });
    // The occasion is two days out; nothing saved says how fast the gift ships.
    await pg.query("update concierge.gift_rounds set occasion_date = current_date + 2 where id = $1", [r.roundId]);
    await pg.query("update concierge.gift_ideas set handling_days_max = null, delivery_days_max = null where id = $1", [r.ideaIds[0]]);
    await approvedOnly(u, r);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.calls).toEqual([]);
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "too_late" });

    // Far enough out, the same null range is fine.
    const far = await newRound(u);
    await pg.query("update concierge.gift_ideas set handling_days_max = null, delivery_days_max = null where id = $1", [far.ideaIds[0]]);
    await approvedOnly(u, far);
    await placeHeldForUser(u.userId, deps());
    expect(zinc.posts).toHaveLength(1);
  });

  it("placeHeldForUser: one round failing doesn't stop the next", async () => {
    const u = await newUser();
    const first = await newRound(u, { deadlineIn: 20 });
    const second = await newRound(u, { deadlineIn: 25 });
    await approvedOnly(u, first);
    await approvedOnly(u, second);
    await placeHeldForUser(u.userId, deps({ db: failingRpc("begin_placing", first.roundId) }));
    expect(zinc.posts.map((p) => p.ref)).toEqual([(await orders(second.roundId))[0].id]);
    // The failed round's lease was given back.
    expect((await round(first.roundId)).locked_until).toBeNull();
  });

  it("placeHeldForUser: one time budget across rounds; once spent, no new round is claimed", async () => {
    const u = await newUser();
    const first = await newRound(u, { deadlineIn: 20 });
    const second = await newRound(u, { deadlineIn: 25 });
    await approvedOnly(u, first);
    await approvedOnly(u, second);
    let t = 0;
    zinc.onPost = () => {
      t += 60_000;
    };
    await placeHeldForUser(u.userId, deps({ clock: () => t }));
    expect(zinc.posts.map((p) => p.ref)).toEqual([(await orders(first.roundId))[0].id]);
    expect(await round(second.roundId)).toMatchObject({ attention_reason: "retry", locked_until: null });
    expect((await orders(second.roundId))[0].status).toBe("held");
  });

  it("stops starting POSTs once the time budget is spent; the rest wait unsent", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [4200, 5000] });
    let t = 0;
    zinc.onPost = () => {
      t += 60_000;
    };
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps({ clock: () => t }));
    const [a, b] = await orders(r.roundId);
    expect(zinc.posts.map((p) => p.ref)).toEqual([a.id]);
    expect(b).toMatchObject({ status: "held", hold_reason: "retry" });
  });

  it("placeRound needs the lease", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approvedOnly(u, r);
    expect(await placeRound(r.roundId, new Date(), deps())).toBe("not_ready");
    expect(zinc.calls).toEqual([]);
  });
});
