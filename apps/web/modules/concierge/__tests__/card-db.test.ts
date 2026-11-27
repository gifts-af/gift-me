// Saving, replacing, reading and removing a card (AC-1, AC-2, AC-13, AC-17, AC-21) on the real
// local database (E5): the SQL start_card_session, save_card and remove_card are the real thing;
// only Stripe is faked (fake-stripe.ts). Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { FakeStripe } from "./fake-stripe";

vi.mock("server-only", () => ({}));
const { finishCardSession, removeCard, savedCard, startCardSession, CARD_CONSENT_TEXT } = await import("../stripe/card");
type CardDeps = import("../stripe/card").CardDeps;

const stack = await localStack({ api: true });
const dbUp = stack !== null;
const SITE = "https://giftsaf.test";

describe.skipIf(!dbUp)("saving a card (real local database, fake Stripe)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  let pg: Client;
  const users: string[] = [];
  let stripe: FakeStripe;
  let connectWas: string;

  const deps = (): CardDeps => ({ db: admin!, now: new Date(), stripe: stripe.http(), siteUrl: SITE });

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    connectWas = (await pg.query("select value from concierge.app_settings where key = 'connect_enabled'")).rows[0].value;
    await pg.query("update concierge.app_settings set value = '1' where key = 'connect_enabled'");
  });
  afterAll(async () => {
    await pg.query("update concierge.app_settings set value = $1 where key = 'connect_enabled'", [connectWas]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(() => {
    stripe = new FakeStripe("test");
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function newUser(o: { phone?: string | null } = {}): Promise<string> {
    const email = `card-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password: "local-only-password", email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone) values ($1, true, $2)", [
      data.user.id,
      o.phone === undefined ? "5555550100" : o.phone,
    ]);
    return data.user.id;
  }

  async function newRound(userId: string): Promise<{ roundId: string; ideaIds: string[] }> {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'Mary', 'friend') returning id", [userId]);
    const personId = person.rows[0].id as string;
    const occ = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, personId]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 10000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [userId, personId, occ.rows[0].id],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    for (const [i, title] of ["Fly rod", "Reel", "Net"].entries()) {
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source)
         values ($1, $2, $3, $4, 'https://shop.test/p', 4000, 4100, 2, 3, 5, $5, 'generated') returning id`,
        [userId, roundId, personId, title, i + 1],
      );
      ideaIds.push(idea.rows[0].id as string);
    }
    return { roundId, ideaIds };
  }

  async function newOrder(userId: string, roundId: string, ideaId: string, status: string, pm: string | null, failure: string | null = null) {
    const r = await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, ship_to, ship_city, ship_state, status, failure_type,
                                     margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents, max_charge_cents, payment_method_id)
       values ($1, $2, $3, 'connect', 4500, 300, 'recipient', 'Dayton', 'OH', $4, $5, 100, 100, 290, 30, 4900, $6) returning id`,
      [userId, roundId, ideaId, status, failure, pm ?? "pm_unused"],
    );
    return r.rows[0].id as string;
  }

  const account = async (userId: string) =>
    (await pg.query("select buyer_phone, stripe_customer_id, stripe_payment_method_id from concierge.accounts where user_id = $1", [userId])).rows[0];

  async function startedFromRound(userId: string, ideas = 2) {
    const r = await newRound(userId);
    const out = await startCardSession(deps(), { userId, from: { roundId: r.roundId, ideaIds: r.ideaIds.slice(0, ideas) } });
    if (typeof out === "string") throw new Error(`start returned ${out}`);
    const sessionId = [...stripe.sessions.keys()].at(-1)!;
    return { ...r, url: out.url, sessionId };
  }

  /** Start from Settings and finish on Stripe's page, saving a card. */
  async function saveCard(userId: string): Promise<string> {
    const out = await startCardSession(deps(), { userId, from: "settings" });
    if (typeof out === "string") throw new Error(`start returned ${out}`);
    const sessionId = [...stripe.sessions.keys()].at(-1)!;
    const pm = stripe.complete(sessionId);
    const done = await finishCardSession(deps(), { userId, sessionId });
    expect(done).toEqual({ status: "saved", backTo: "/settings/paying" });
    return pm;
  }

  // ─── starting ─────────────────────────────────────────────────────────────

  it("AC-12: is off, with no Stripe call, while connect_enabled isn't 1", async () => {
    const u = await newUser();
    await pg.query("update concierge.app_settings set value = '0' where key = 'connect_enabled'");
    try {
      expect(await startCardSession(deps(), { userId: u, from: "settings" })).toBe("off");
    } finally {
      await pg.query("update concierge.app_settings set value = '1' where key = 'connect_enabled'");
    }
    expect(stripe.requests).toEqual([]);
  });

  it("AC-1, AC-21: creates a customer with our user id only and a card-only setup session", async () => {
    const u = await newUser();
    const { roundId, url, sessionId } = await startedFromRound(u);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

    const [cust, sess] = stripe.requests;
    expect(cust.path).toBe("/v1/customers");
    expect([...cust.body.keys()]).toEqual(["metadata[user_id]"]);
    expect(cust.body.get("metadata[user_id]")).toBe(u);
    expect(cust.idempotencyKey).toContain(u);

    expect(sess.path).toBe("/v1/checkout/sessions");
    const b = sess.body;
    expect(b.get("mode")).toBe("setup");
    expect(b.get("currency")).toBe("usd");
    expect(b.getAll("payment_method_types[0]")).toEqual(["card"]);
    expect([...b.keys()].filter((k) => k.startsWith("payment_method_types"))).toEqual(["payment_method_types[0]"]);
    expect([...b.keys()].some((k) => k.startsWith("customer_update"))).toBe(false);
    expect(b.get("customer")).toBe([...stripe.customers.keys()][0]);
    expect(b.get("success_url")).toBe(`${SITE}/rounds/card/return?session_id={CHECKOUT_SESSION_ID}`);
    expect(b.get("cancel_url")).toBe(`${SITE}/rounds/card/return?session_id={CHECKOUT_SESSION_ID}`);
    expect(b.get("custom_text[submit][message]")).toBe(CARD_CONSENT_TEXT);

    // No email, name or phone goes to Stripe (T42).
    for (const r of stripe.requests) expect(r.body.toString()).not.toMatch(/example\.test|Mary|5555550100|email|name|phone/i);

    // The customer is on the account at once, and the visit is recorded.
    expect((await account(u)).stripe_customer_id).toBe(b.get("customer"));
    const row = (await pg.query("select user_id, round_id from concierge.card_sessions where stripe_session_id = $1", [sessionId])).rows[0];
    expect(row).toEqual({ user_id: u, round_id: roundId });
  });

  it("AC-2: refuses another buyer's round, saving no visit", async () => {
    const me = await newUser();
    const other = await newUser();
    const theirs = await newRound(other);
    expect(await startCardSession(deps(), { userId: me, from: { roundId: theirs.roundId, ideaIds: [] } })).toBe("not_yours");
    expect((await pg.query("select count(*)::int as n from concierge.card_sessions where user_id = $1", [me])).rows[0].n).toBe(0);
  });

  it("AC-2: refuses another buyer's round, ideas or failed order before any Stripe call", async () => {
    const me = await newUser();
    const other = await newUser();
    const mine = await newRound(me);
    const theirs = await newRound(other);
    const theirFailed = await newOrder(other, theirs.roundId, theirs.ideaIds[0], "failed", null, "card_needed");
    for (const from of [
      { roundId: theirs.roundId, ideaIds: [] },
      { roundId: mine.roundId, ideaIds: [theirs.ideaIds[0]] },
      { roundId: mine.roundId, ideaIds: [], failedOrderId: theirFailed },
      { roundId: theirs.roundId, ideaIds: [], failedOrderId: theirFailed },
    ]) {
      expect(await startCardSession(deps(), { userId: me, from })).toBe("not_yours");
    }
    expect(stripe.requests).toEqual([]);
    expect((await account(me)).stripe_customer_id).toBeNull();
  });

  it("T42: the customer is saved at once, so a failed session start leaves it saved and the next start reuses it", async () => {
    const u = await newUser();
    stripe.sessionStatus = 500;
    await expect(startCardSession(deps(), { userId: u, from: "settings" })).rejects.toThrow();
    const created = [...stripe.customers.keys()];
    expect(created).toHaveLength(1);
    expect((await account(u)).stripe_customer_id).toBe(created[0]);

    // A day later Stripe's idempotency key has expired: still no second customer.
    stripe = new FakeStripe("test");
    const out = await startCardSession(deps(), { userId: u, from: "settings" });
    expect(out).toHaveProperty("url");
    expect(stripe.requests.filter((r) => r.path === "/v1/customers")).toEqual([]);
    expect(stripe.requests.find((r) => r.path === "/v1/checkout/sessions")?.body.get("customer")).toBe(created[0]);
  });

  it("T42: a customer saved by another start meanwhile wins; ours is left unused and logged without ids", async () => {
    const u = await newUser();
    stripe.afterCustomer = async () => {
      await pg.query("update concierge.accounts set stripe_customer_id = 'cus_other_start' where user_id = $1", [u]);
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await startCardSession(deps(), { userId: u, from: "settings" })).toHaveProperty("url");
      const raced = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => e.event === "card.customer_raced");
      expect(raced).toEqual([expect.objectContaining({ user_id: u })]);
      expect(JSON.stringify(raced)).not.toMatch(/cus_/);
    } finally {
      log.mockRestore();
    }
    expect((await account(u)).stripe_customer_id).toBe("cus_other_start");
    expect(stripe.requests.find((r) => r.path === "/v1/checkout/sessions")?.body.get("customer")).toBe("cus_other_start");
  });

  it("AC-17: asks for a phone when the account has none, and saves it", async () => {
    const u = await newUser({ phone: null });
    expect(await startCardSession(deps(), { userId: u, from: "settings" })).toBe("bad_phone");
    expect(await startCardSession(deps(), { userId: u, from: "settings", phone: "555-01" })).toBe("bad_phone");
    expect(stripe.requests).toEqual([]);
    const out = await startCardSession(deps(), { userId: u, from: "settings", phone: "+1 (555) 555-0199" });
    expect(out).toHaveProperty("url");
    expect((await account(u)).buyer_phone).toBe("5555550199");
  });

  // ─── coming back ──────────────────────────────────────────────────────────

  it("AC-1: saves the card and sends the buyer back to the same gift; a replayed return is used", async () => {
    const u = await newUser();
    const { roundId, ideaIds, sessionId } = await startedFromRound(u);
    const pm = stripe.complete(sessionId);
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toEqual({
      status: "saved",
      backTo: `/rounds/${roundId}/buy?ideas=${ideaIds.slice(0, 2).join(",")}`,
    });
    expect((await account(u)).stripe_payment_method_id).toBe(pm);
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toBe("used");
  });

  it("AC-2: a cancelled visit saves nothing and goes back to the gift", async () => {
    const u = await newUser();
    const { roundId, sessionId } = await startedFromRound(u, 0);
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toEqual({ status: "cancelled", backTo: `/rounds/${roundId}` });
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("AC-2: a session Stripe reports complete but whose setup didn't succeed saves nothing", async () => {
    const u = await newUser();
    const { sessionId } = await startedFromRound(u);
    stripe.complete(sessionId, { siStatus: "requires_action" });
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toMatchObject({ status: "cancelled" });
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("AC-2: another buyer's return link, or an unknown one, saves nothing", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { sessionId } = await startedFromRound(owner);
    stripe.complete(sessionId);
    expect(await finishCardSession(deps(), { userId: other, sessionId })).toBe("not_yours");
    expect(await finishCardSession(deps(), { userId: other, sessionId: "cs_test_nothere" })).toBe("not_yours");
    expect(await finishCardSession(deps(), { userId: other, sessionId: "not a session" })).toBe("not_yours");
    expect((await account(owner)).stripe_payment_method_id).toBeNull();
    expect((await account(other)).stripe_payment_method_id).toBeNull();
  });

  it.each([
    ["the customer differs", (x: { customer: string | null; mode: string; livemode: boolean }) => void (x.customer = "cus_someone_else")],
    ["the mode isn't setup", (x: { mode: string }) => void (x.mode = "payment")],
    ["it's a live session on a test key", (x: { livemode: boolean }) => void (x.livemode = true)],
  ])("AC-2: saves nothing when %s", async (_why, change) => {
    const u = await newUser();
    const { sessionId } = await startedFromRound(u);
    stripe.complete(sessionId);
    change(stripe.sessions.get(sessionId)! as never);
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toBe("not_yours");
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("AC-2: saves nothing when the card isn't set up for later charges", async () => {
    const u = await newUser();
    const { sessionId } = await startedFromRound(u);
    stripe.complete(sessionId, { usage: "on_session" });
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toBe("not_yours");
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("AC-2: a visit older than card_session_minutes is used", async () => {
    const u = await newUser();
    const { sessionId } = await startedFromRound(u);
    stripe.complete(sessionId);
    await pg.query(
      "update concierge.card_sessions set created_at = now() - make_interval(mins => concierge.setting_int('card_session_minutes') + 1) where stripe_session_id = $1",
      [sessionId],
    );
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toBe("used");
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("goes back to the fix page for a failed gift", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const failed = await newOrder(u, r.roundId, r.ideaIds[0], "failed", null, "card_needed");
    await startCardSession(deps(), { userId: u, from: { roundId: r.roundId, ideaIds: [], failedOrderId: failed } });
    const sessionId = [...stripe.sessions.keys()].at(-1)!;
    stripe.complete(sessionId);
    expect(await finishCardSession(deps(), { userId: u, sessionId })).toEqual({ status: "saved", backTo: `/rounds/${r.roundId}/fix/${failed}` });
  });

  // ─── replacing, reading and removing ─────────────────────────────────────

  it("AC-13: Replace reuses the customer and detaches the old card; Remove detaches the rest", async () => {
    const u = await newUser();
    const first = await saveCard(u);
    const second = await saveCard(u);
    expect(stripe.requests.filter((r) => r.path === "/v1/customers")).toHaveLength(1);
    const cus = (await account(u)).stripe_customer_id as string;
    expect(stripe.cards.get(cus)).toEqual([second]);
    expect((await account(u)).stripe_payment_method_id).toBe(second);
    expect(first).not.toBe(second);

    expect(await removeCard(deps(), u)).toBe("ok");
    expect(stripe.cards.get(cus)).toEqual([]);
    expect((await account(u)).stripe_payment_method_id).toBeNull();
    expect((await account(u)).stripe_customer_id).toBe(cus);
  });

  it("AC-13: keeps a card an unconfirmed order was sent on, so Zinc can still capture its hold", async () => {
    const u = await newUser();
    const pm = await saveCard(u);
    const r = await newRound(u);
    await newOrder(u, r.roundId, r.ideaIds[0], "unconfirmed", pm);
    expect(await removeCard(deps(), u)).toBe("ok");
    const cus = (await account(u)).stripe_customer_id as string;
    expect(stripe.cards.get(cus)).toEqual([pm]);
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("AC-13: refuses Remove while an order is placing, with no Stripe call", async () => {
    const u = await newUser();
    const pm = await saveCard(u);
    const r = await newRound(u);
    await newOrder(u, r.roundId, r.ideaIds[0], "placing", pm);
    stripe.requests = [];
    expect(await removeCard(deps(), u)).toBe("placing");
    expect(stripe.requests).toEqual([]);
    expect((await account(u)).stripe_payment_method_id).toBe(pm);
  });

  it("AC-13: a failed detach is reported and logged, with no ids", async () => {
    const u = await newUser();
    const pm = await saveCard(u);
    stripe.failDetach.add(pm);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await removeCard(deps(), u)).toBe("detach_failed");
      const lines = log.mock.calls.map((c) => String(c[0]));
      const line = lines.find((l) => l.includes('"card.detach_failed"'));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/pm_|cus_|sk_/);
    } finally {
      log.mockRestore();
    }
    expect((await account(u)).stripe_payment_method_id).toBeNull();
  });

  it("reads the saved card's brand and last four live from Stripe, or null without one", async () => {
    const u = await newUser();
    expect(await savedCard(deps(), u)).toBeNull();
    await saveCard(u);
    expect(await savedCard(deps(), u)).toEqual({ brand: "visa", last4: "4242" });
  });
});
