// Replacing a failed gift and checking today's price (ALL-29 AC-14, AC-15, AC-15a, AC-12b,
// AC-19). Our own database is real (local Supabase, E5); only Zinc is faked, and the fake
// refuses an order whose max_price is below its product's price, as Zinc does.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { storeName } from "@gifts-af/core/store-page/link";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { RecordCost } from "../costs/record";
import { approveAndBuy } from "../purchase/approve";
import { quoteFailedOrder, replaceFailedOrder, type QuoteDeps } from "../purchase/replace";
import type { PurchaseDeps } from "../purchase/store";
import { FakeZinc } from "./fake-zinc";

const stack = await localStack({ api: true });
const dbUp = stack !== null;
const supabase = stack?.supabase ?? null;

/** The app's own lookup key (T17) in these tests. */
const APP_KEY = "zn_app_lookup";

describe.skipIf(!dbUp)("replace a failed gift (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  let killSwitchBefore: string;
  let taxPct: number;
  const advanceRound = vi.fn<(roundId: string) => Promise<unknown>>(async () => "advanced");
  const recordCost = vi.fn<RecordCost>(async () => {});
  let lookupCents: number;

  const setSwitch = (on: boolean) =>
    pg.query("update concierge.app_settings set value = $1 where key = 'zinc_ordering_enabled'", [on ? "1" : "0"]);

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    killSwitchBefore = (await pg.query("select value from concierge.app_settings where key = 'zinc_ordering_enabled'")).rows[0].value;
    lookupCents = Number((await pg.query("select value from concierge.app_settings where key = 'zinc_lookup_cents'")).rows[0].value);
    taxPct = Number((await pg.query("select value from concierge.app_settings where key = 'idea_tax_estimate_pct'")).rows[0].value);
  });
  afterAll(async () => {
    await pg.query("update concierge.app_settings set value = $1 where key = 'zinc_ordering_enabled'", [killSwitchBefore]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    await setSwitch(true);
    zinc = new FakeZinc((key) => key === APP_KEY || users.some((u) => key === `zn_test_${u}`));
    advanceRound.mockClear();
    recordCost.mockReset();
    recordCost.mockImplementation(async () => {});
  });

  const deps = (over: Partial<PurchaseDeps & QuoteDeps> = {}): PurchaseDeps & QuoteDeps => {
    const http = { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch };
    return {
      db: createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } }),
      http,
      env: "test",
      webhookBaseUrl: "https://giftsaf.test",
      now: new Date(),
      settings: { feeCents: 100, marginPct: 10 },
      advanceRound,
      sleep: async () => {},
      clock: () => 0,
      lookup: { http, key: APP_KEY },
      recordCost,
      ...over,
    };
  };

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function newUser(o: { paid?: boolean } = {}): Promise<string> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `replace-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone) values ($1, $2, '5555550100')", [userId, o.paid ?? true]);
    await pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${userId}`, `zn_whsec_${randomUUID()}`, randomUUID()]);
    return userId;
  }

  type Round = { roundId: string; personId: string; ideaIds: string[]; productIds: string[] };
  async function newRound(userId: string, o: { budget?: number | null; totals?: number[] } = {}): Promise<Round> {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      userId,
      person.rows[0].id,
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, $4, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [userId, person.rows[0].id, occasion.rows[0].id, o.budget === undefined ? 10000 : o.budget],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    const productIds: string[] = [];
    for (const [i, total] of (o.totals ?? [4200]).entries()) {
      const productId = `B${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, retailer, retailer_product_id, offer_id, price_cents,
                                           est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank)
         values ($1, $2, 'Gift', 'https://shop.test/pending', 'amazon', $3, $4, $5, $5, 2, 3, 5, $6) returning id`,
        [userId, roundId, productId, `off_${productId}`, total, i + 1],
      );
      const id = idea.rows[0].id as string;
      await pg.query("update concierge.gift_ideas set product_url = $2 where id = $1", [id, urlOf(id)]);
      ideaIds.push(id);
      productIds.push(productId);
    }
    return { roundId, personId: person.rows[0].id, ideaIds, productIds };
  }
  const urlOf = (ideaId: string) => `https://shop.test/p/${ideaId}`;

  const orders = async (roundId: string) =>
    (
      await pg.query(
        `select o.id, o.idea_id, o.status, o.failure_type, o.resolved, o.max_price_cents, o.ship_to, o.address_source, o.gift_message
           from concierge.orders o where o.round_id = $1 order by o.created_at, o.id`,
        [roundId],
      )
    ).rows;
  const round = async (roundId: string) =>
    (await pg.query("select status::text as status, attention_reason, locked_until from concierge.gift_rounds where id = $1", [roundId])).rows[0];

  /** Bought with approveAndBuy; Zinc turns the first POST of each failing idea down synchronously. */
  async function boughtAndFailed(userId: string, r: Round, failing: Record<number, string>, picks = [0]): Promise<string[]> {
    for (const [i, code] of Object.entries(failing)) zinc.plan.set(urlOf(r.ideaIds[Number(i)]), [{ status: 400, code }, "ok"]);
    const result = await approveAndBuy({ userId, roundId: r.roundId, ideaIds: picks.map((i) => r.ideaIds[i]), giftMessage: "Love you" }, deps());
    expect(result.ok).toBe(true);
    return (await orders(r.roundId)).map((o) => o.id);
  }

  const totalAt = (priceCents: number) => priceCents + Math.round((priceCents * taxPct) / 100) + 100;
  const offerCalls = () => zinc.calls.filter((c) => c.startsWith("GET /products/"));

  // ─── a price rise (AC-14) ─────────────────────────────────────────────────

  it("a price_up re-buy places at the new price", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "price_up" });
    // Today Zinc charges 5000, more than the first cap (4520) allowed.
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    zinc.products.set(urlOf(r.ideaIds[0]), { priceCents: 5000 });
    zinc.calls = [];

    const quote = await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps());
    expect(quote).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
    // Read-only: nothing was written.
    expect(await orders(r.roundId)).toHaveLength(1);

    const result = await replaceFailedOrder(
      { userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) },
      deps(),
    );
    expect(result).toEqual({ ok: true, status: "ordered", reason: null });
    const [old, fresh] = await orders(r.roundId);
    expect(old).toMatchObject({ id: failed, status: "failed", resolved: true });
    const cap = Math.min(10000 - 100, Math.floor((totalAt(5000) * 110) / 100) - 100);
    // The new order keeps the gift note and ship-to; the fake would fail any cap below 5000.
    expect(fresh).toMatchObject({ idea_id: r.ideaIds[0], status: "placing", max_price_cents: cap, gift_message: "Love you", ship_to: "recipient" });
    expect(zinc.posts.at(-1)).toMatchObject({ ref: fresh.id, maxPrice: cap });
    expect(zinc.orders.get(fresh.id)?.status).toBe("processing");
    const idea = await pg.query("select est_total_cents from concierge.gift_ideas where id = $1", [r.ideaIds[0]]);
    expect(idea.rows[0].est_total_cents).toBe(totalAt(5000));
    // Two quotes: the check, and once more under the lease.
    expect(offerCalls()).toHaveLength(2);
  });

  it("Check today's price records one estimated price-check cost for the failed order and its buyer", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps());
    expect(recordCost.mock.calls).toEqual([[{ userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed }]]);
  });

  it("the re-check inside Buy records its own price-check cost, after the lease is let go", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    zinc.products.set(urlOf(r.ideaIds[0]), { priceCents: 5000 });
    let leaseDuringRecord: unknown = "unset";
    recordCost.mockImplementation(async () => {
      leaseDuringRecord = (await round(r.roundId)).locked_until;
    });
    const result = await replaceFailedOrder(
      { userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) },
      deps(),
    );
    expect(result).toMatchObject({ ok: true });
    expect(recordCost.mock.calls).toEqual([[{ userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed }]]);
    expect(leaseDuringRecord).toBeNull();
  });

  it("a plain Error from the lookup is rethrown, and the call's cost is still recorded", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    const broken = {
      base: "https://zinc.test",
      timeoutMs: 1000,
      fetch: (async () => ({
        get status(): number {
          throw new Error("boom");
        },
      })) as unknown as typeof fetch,
    };
    await expect(quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps({ lookup: { http: broken, key: APP_KEY } }))).rejects.toThrow("boom");
    expect(recordCost.mock.calls).toEqual([[{ userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed }]]);
  });

  it("a recorder that throws synchronously can't change the quote either", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    recordCost.mockImplementationOnce((() => {
      throw new Error("sync");
    }) as RecordCost);
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
  });

  it("a Zinc error after the call still records the lookup, and the answer is unchanged", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    const http = { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch };
    const refused = deps({ lookup: { http, key: "zn_not_known" } });
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, refused)).toBe("unavailable");
    expect(recordCost.mock.calls).toEqual([[{ userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed }]]);
  });

  it("a price check with no live price to look up makes no call and records nothing", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    await pg.query("update concierge.gift_ideas set retailer_product_id = null where id = $1", [r.ideaIds[0]]);
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("unavailable");
    expect(recordCost).not.toHaveBeenCalled();
  });

  it("a recorder that fails can't change the quote", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    recordCost.mockRejectedValueOnce(new Error("down"));
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
  });

  it("the re-buy is refused when the price rose again since the page loaded", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    zinc.calls = [];
    zinc.posts = [];
    const quote = await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps());
    expect(quote).toEqual({ oldCents: 4200, newCents: totalAt(5000) });

    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5600 });
    recordCost.mockClear();
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) }, deps()),
    ).toEqual({ ok: false, error: "price_changed" });
    expect(offerCalls()).toHaveLength(2);
    // The re-check inside Buy was a paid call, so it's recorded though the Buy was refused.
    expect(recordCost.mock.calls).toEqual([[{ userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed }]]);
    expect(zinc.posts).toEqual([]);
    expect(await orders(r.roundId)).toEqual([expect.objectContaining({ id: failed, status: "failed", resolved: false })]);
    expect((await round(r.roundId)).locked_until).toBeNull();
  });

  it("a second price rise on the same gift is offered no re-buy", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    // Zinc turns down the first order and the re-buy alike.
    zinc.plan.set(urlOf(r.ideaIds[0]), [{ status: 400, code: "max_price_exceeded" }]);
    await approveAndBuy({ userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps());
    const [failed] = (await orders(r.roundId)).map((o) => o.id);
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) }, deps()),
    ).toMatchObject({ ok: true, status: "failed", reason: "price_up" });
    const second = (await orders(r.roundId))[1];
    expect(second).toMatchObject({ status: "failed", failure_type: "price_up", resolved: false });
    zinc.calls = [];

    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: second.id }, deps())).toBe("once");
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: second.id, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) }, deps()),
    ).toEqual({ ok: false, error: "once" });
    expect(zinc.calls).toEqual([]);
    expect(await orders(r.roundId)).toHaveLength(2);
  });

  it("a quote for a failure already fixed (a stale tab) is not_current and looks nothing up", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    await pg.query("update concierge.orders set resolved = true where id = $1", [failed]);
    zinc.calls = [];
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("not_current");
    expect(zinc.calls).toEqual([]);
  });

  it("a quote on a round that's closed, past its ship-by day or no longer needing attention is not_open and looks nothing up", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    expect(await round(r.roundId)).toMatchObject({ status: "needs_attention" });
    const quote = () => quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps());
    zinc.calls = [];

    await pg.query("update concierge.gift_rounds set closed_at = now() where id = $1", [r.roundId]);
    expect(await quote()).toBe("not_open");
    await pg.query("update concierge.gift_rounds set closed_at = null, ship_by_deadline = current_date where id = $1", [r.roundId]);
    expect(await quote()).toBe("not_open");
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date + 30, status = 'awaiting_approval' where id = $1", [r.roundId]);
    expect(await quote()).toBe("not_open");
    expect(zinc.calls).toEqual([]);
  });

  it("with zinc_ordering_enabled off, a quote is zinc_off and looks nothing up", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.calls = [];
    await setSwitch(false);
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("zinc_off");
    expect(zinc.calls).toEqual([]);
  });

  it("a gift with no live price can't be re-quoted", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    await pg.query("update concierge.gift_ideas set retailer_product_id = null where id = $1", [r.ideaIds[0]]);
    zinc.calls = [];
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("unavailable");
    expect(zinc.calls).toEqual([]);
  });

  // ─── a price rise on a list gift ──────────────────────────────────────────

  /** Makes the round's idea a list gift as the idea run saves one: the store's display name, the list's link, and Zinc's id. */
  async function asListGift(userId: string, r: Round, g: { url: string; productId: string | null; offerId?: string }): Promise<void> {
    const owner = await newUser();
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner]);
    const item = await pg.query(
      "insert into lists.list_items (list_id, position, name, price_cents, product_url) values ($1, 0, 'Gift', 4000, $2) returning id",
      [list.rows[0].id, g.url],
    );
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      r.personId,
      userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);
    await pg.query(
      `update concierge.gift_ideas set source = 'list', list_item_id = $2, product_url = $3, retailer = $4,
              retailer_product_id = $5, offer_id = $6 where id = $1`,
      [r.ideaIds[0], item.rows[0].id, g.url, storeName(g.url), g.productId, g.offerId ?? null],
    );
  }

  /** A list gift whose order failed with a price rise. */
  async function failedListGift(g: { url: string; productId: string | null; offerId?: string }) {
    const userId = await newUser();
    const r = await newRound(userId);
    await asListGift(userId, r, g);
    zinc.plan.set(g.url, [{ status: 400, code: "max_price_exceeded" }, "ok"]);
    expect(await approveAndBuy({ userId, roundId: r.roundId, ideaIds: r.ideaIds }, deps())).toMatchObject({ reason: "price_up" });
    const [failed] = (await orders(r.roundId)).map((o) => o.id as string);
    zinc.calls = [];
    return { userId, r, failed };
  }

  const LIST_GIFTS = [
    { store: "Amazon", url: "https://www.amazon.com/dp/B0LISTGIFT?th=1", productId: "B0LISTGIFT", offerId: "off_B0LISTGIFT", catalog: "amazon:B0LISTGIFT", path: "/products/B0LISTGIFT/offers" },
    { store: "Amazon, another host and seller", url: "https://smile.amazon.com/gp/product/B0LISTGIF2", productId: "B0LISTGIF2", offerId: "off_gone", catalog: "amazon:B0LISTGIF2", path: "/products/B0LISTGIF2/offers" },
    { store: "Walmart", url: "https://www.walmart.com/ip/Kettle/123456789", productId: "123456789", catalog: "walmart:123456789", path: "/products/123456789/offers" },
    { store: "Etsy", url: "https://www.etsy.com/listing/6525410/mug", productId: "6525410", catalog: "etsy:6525410", path: "/products/6525410" },
    { store: "a Shopify store", url: "https://www.yetch.store/products/blue-mug", productId: "blue-mug", catalog: "yetch.store:blue-mug", path: "/products/blue-mug" },
    { store: "a Shopify store with a percent-encoded handle", url: "https://yetch.store/products/caf%C3%A9-mug", productId: "café-mug", catalog: "yetch.store:café-mug", path: "/products/caf%C3%A9-mug" },
    ...["/gp/aw/d/", "/product/", "/exec/obidos/ASIN/", "/dp/product/", "/Cedar-Fly-Box/dp/"].map((at) => ({
      store: `Amazon (${at})`,
      url: `https://www.amazon.com${at}b0listgift`,
      productId: "B0LISTGIFT",
      catalog: "amazon:B0LISTGIFT",
      path: "/products/B0LISTGIFT/offers",
    })),
  ];

  it.each(LIST_GIFTS)("a list gift from $store is checked and bought at today's price, one recorded lookup each", async (g) => {
    const { userId, r, failed } = await failedListGift(g);
    zinc.catalog.set(g.catalog, { priceCents: 5000 });
    zinc.products.set(g.url, { priceCents: 5000 });
    const cost = { userId, kind: "lookup_price_check", cents: lookupCents, estimated: true, orderId: failed };

    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
    expect(zinc.calls).toEqual([`GET ${g.path}`]);
    expect(recordCost.mock.calls).toEqual([[cost]]);

    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) }, deps()),
    ).toEqual({ ok: true, status: "ordered", reason: null });
    expect(offerCalls()).toEqual([`GET ${g.path}`, `GET ${g.path}`]);
    expect(recordCost.mock.calls).toEqual([[cost], [cost]]);
    expect(zinc.posts.at(-1)).toMatchObject({ url: g.url });
    // The stored display name is left as it was.
    const idea = await pg.query("select retailer from concierge.gift_ideas where id = $1", [r.ideaIds[0]]);
    expect(idea.rows[0].retailer).toBe(storeName(g.url));
  });

  it.each([
    { why: "an Amazon link to another product", url: "https://www.amazon.com/dp/B0OTHERONE", productId: "B0LISTGIFT", outcome: "link_mismatch" },
    { why: "an Amazon link with no ASIN", url: "https://www.amazon.com/products/B0LISTGIFT", productId: "B0LISTGIFT", outcome: "no_live_price" },
    { why: "an ASIN saved with another store's link", url: "https://yetch.store/products/blue-mug", productId: "B0LISTGIFT", outcome: "link_mismatch" },
    { why: "a store Zinc only checks", url: "https://www.rei.com/product/123/mug", productId: null, outcome: "no_live_price" },
    { why: "a store Zinc only checks, with an id saved", url: "https://www.rei.com/product/123/mug", productId: "123", outcome: "no_live_price" },
    { why: "a link that names another product than the one priced", url: "https://www.walmart.com/ip/Kettle/123456789", productId: "987654321", outcome: "link_mismatch" },
    { why: "a routable store that was priced from the list", url: "https://www.etsy.com/listing/6525410/mug", productId: null, outcome: "no_live_price" },
  ])("a list gift that can't be re-checked ($why) makes no lookup and records no cost", async (g) => {
    let lines: unknown[] = [];
    const { userId, r, failed } = await failedListGift(g);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const quoted = await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps()).finally(() => {
      lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
      log.mockRestore();
    });
    expect(quoted).toBe("unavailable");
    expect(lines).toContainEqual(expect.objectContaining({ event: "order.requote", outcome: g.outcome, lookups: 0, cents: 0 }));
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: 9000 }, deps()),
    ).toEqual({ ok: false, error: "unavailable" });
    expect(zinc.calls).toEqual([]);
    expect(recordCost).not.toHaveBeenCalled();
  });

  it("a list gift with a product id but no link makes no lookup", async () => {
    const { userId, r, failed } = await failedListGift(LIST_GIFTS[0]);
    await pg.query("update concierge.gift_ideas set product_url = null where id = $1", [r.ideaIds[0]]);
    zinc.catalog.set(LIST_GIFTS[0].catalog, { priceCents: 5000 });
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("unavailable");
    expect(zinc.calls).toEqual([]);
    expect(recordCost).not.toHaveBeenCalled();
  });

  it("a Shopify reply with the store's numeric id counts when its handle matches, and not when it doesn't", async () => {
    const { userId, r, failed } = await failedListGift({ url: "https://yetch.store/products/blue-mug", productId: "blue-mug" });
    const quote = () => quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps());
    zinc.catalog.set("yetch.store:blue-mug", { priceCents: 5000, productId: "8123456", handle: "blue-mug" });
    expect(await quote()).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
    zinc.catalog.set("yetch.store:blue-mug", { priceCents: 5000, productId: "8123456", handle: "red-mug" });
    expect(await quote()).toBe("unavailable");
  });

  it("a list gift's re-check prefers its own seller over a cheaper buy-box one", async () => {
    const { userId, r, failed } = await failedListGift({ url: "https://www.amazon.com/dp/B0LISTGIFT", productId: "B0LISTGIFT", offerId: "off_own" });
    zinc.catalog.set("amazon:B0LISTGIFT", {
      priceCents: 4500,
      offers: [
        { offerId: "off_best", priceCents: 4500 },
        { offerId: "off_own", priceCents: 5000 },
      ],
    });
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
  });

  it("an AI idea is still looked up by its saved store and id, whatever its link", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    await pg.query("update concierge.gift_ideas set product_url = 'https://www.walmart.com/ip/1' where id = $1", [r.ideaIds[0]]);
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    zinc.calls = [];
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toEqual({ oldCents: 4200, newCents: totalAt(5000) });
    expect(zinc.calls).toEqual([`GET /products/${r.productIds[0]}/offers`]);
  });

  // ─── budget (AC-15, AC-6, AC-7) ───────────────────────────────────────────

  async function placedAndFailed(totals: number[]) {
    const userId = await newUser();
    const r = await newRound(userId, { budget: 5000, totals });
    await boughtAndFailed(userId, r, { 1: "out_of_stock" }, [0, 1]);
    const all = await orders(r.roundId);
    const placed = all.find((o) => o.idea_id === r.ideaIds[0])!.id;
    const failed = all.find((o) => o.idea_id === r.ideaIds[1])!.id;
    // $30 placed: Zinc's real total plus the fee.
    await pg.query("update concierge.orders set status = 'placed', total_cents = 2900 where id = $1", [placed]);
    return { userId, r, failed };
  }

  it("replace counts the round's other placed order against the budget", async () => {
    const { userId, r, failed } = await placedAndFailed([3000, 2000, 2500]);
    const input = { userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[2] };
    expect(await replaceFailedOrder(input, deps())).toEqual({ ok: false, error: "needs_confirmation" });
    expect(await orders(r.roundId)).toHaveLength(2);

    expect(await replaceFailedOrder({ ...input, overBudgetConfirmed: true }, deps())).toEqual({ ok: true, status: "ordered", reason: null });
    const fresh = (await orders(r.roundId)).find((o) => o.idea_id === r.ideaIds[2]);
    // The ceiling is $30 + $25; the cap is what's left of it, less the fee.
    expect(fresh).toMatchObject({ idea_id: r.ideaIds[2], status: "placing", max_price_cents: 2400, gift_message: "Love you" });
  });

  it("replace past the over-budget allowance is refused", async () => {
    const { userId, r, failed } = await placedAndFailed([3000, 2000, 4000]);
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[2], overBudgetConfirmed: true }, deps()),
    ).toEqual({ ok: false, error: "over_budget" });
    expect(await orders(r.roundId)).toHaveLength(2);
  });

  it("replacing with an idea that isn't on offer any more returns replaced", async () => {
    const userId = await newUser();
    const r = await newRound(userId, { totals: [3000, 2000] });
    const [failed] = await boughtAndFailed(userId, r, { 0: "out_of_stock" });
    await pg.query("update concierge.gift_ideas set status = 'rejected' where id = $1", [r.ideaIds[1]]);
    expect(await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[1] }, deps())).toEqual({
      ok: false,
      error: "replaced",
    });
    // Nor the same gift again after it went out of stock.
    expect(await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0] }, deps())).toEqual({
      ok: false,
      error: "replaced",
    });
    expect(await orders(r.roundId)).toHaveLength(1);
  });

  // ─── gates and races (AC-19) ──────────────────────────────────────────────

  it("without paid features replace is refused and calls no Zinc", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    const [failed] = await boughtAndFailed(userId, r, { 0: "max_price_exceeded" });
    zinc.catalog.set(`amazon:${r.productIds[0]}`, { priceCents: 5000 });
    await pg.query("update concierge.accounts set paid_features = false where user_id = $1", [userId]);
    zinc.calls = [];
    expect(await quoteFailedOrder({ userId, roundId: r.roundId, orderId: failed }, deps())).toBe("not_allowed");
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shownTotalCents: totalAt(5000) }, deps()),
    ).toEqual({ ok: false, error: "not_allowed" });
    expect(zinc.calls).toEqual([]);
    expect(await orders(r.roundId)).toHaveLength(1);
  });

  it("another user's round is not_found, and never leased", async () => {
    const userId = await newUser();
    const other = await newUser();
    const r = await newRound(userId, { totals: [3000, 2000] });
    const [failed] = await boughtAndFailed(userId, r, { 0: "out_of_stock" });
    expect(await replaceFailedOrder({ userId: other, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[1] }, deps())).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await quoteFailedOrder({ userId: other, roundId: r.roundId, orderId: failed }, deps())).toBe("not_allowed");
    expect((await round(r.roundId)).locked_until).toBeNull();
  });

  it("two replaces at once: one order, the other busy", async () => {
    const userId = await newUser();
    const r = await newRound(userId, { totals: [3000, 2000] });
    const [failed] = await boughtAndFailed(userId, r, { 0: "out_of_stock" });
    zinc.posts = [];
    let open!: () => void;
    zinc.gate = new Promise<void>((res) => (open = res));
    const posted = new Promise<void>((res) => (zinc.onPost = res));
    const input = { userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[1] };
    const first = replaceFailedOrder(input, deps());
    await posted;
    const second = await replaceFailedOrder(input, deps());
    open();
    expect(second).toEqual({ ok: false, error: "busy" });
    expect(await first).toEqual({ ok: true, status: "ordered", reason: null });
    expect(zinc.posts).toHaveLength(1);
    expect((await orders(r.roundId)).filter((o) => o.status !== "failed")).toHaveLength(1);
    // Once done, the same replace is refused: the failure is dealt with.
    expect(await replaceFailedOrder(input, deps())).toMatchObject({ ok: false });
    expect(await orders(r.roundId)).toHaveLength(2);
  });

  // ─── an address failure (AC-15a, T61) ─────────────────────────────────────

  it("an address_rejected gift isn't resent to the person's own address while it's the address the store refused", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    // A list owner shares an address; the buyer saved the same one on the person.
    const owner = await newUser();
    await pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
       values ($1, 'Sam', 'Rivera', '44 Shared St', 'Akron', 'OH', '44301', true)`,
      [owner],
    );
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner]);
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      r.personId,
      userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);
    await pg.query("update public.people set linked_user_id = $2 where id = $1", [r.personId, owner]);
    await pg.query(
      `update public.people set recipient_first_name = 'Sam', recipient_last_name = 'Rivera', address_line1 = '44 Shared St',
              city = 'Akron', state = 'OH', zip = '44301' where id = $1`,
      [r.personId],
    );
    const [failed] = await boughtAndFailed(userId, r, { 0: "invalid_shipping_address" });
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "address_rejected", address_source: "shared" });
    // The owner stops sharing, so the person's own address is the one to use now.
    await pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner]);
    zinc.posts = [];
    const again = () => replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0] }, deps());

    // It's the address the store refused: not sent there again.
    expect(await again()).toEqual({ ok: false, error: "no_address" });
    expect(await orders(r.roundId)).toHaveLength(1);
    expect(zinc.posts).toEqual([]);

    // Fixed on the person: it ships there.
    await pg.query("update public.people set address_line1 = '46 Shared St' where id = $1", [r.personId]);
    expect(await again()).toEqual({ ok: true, status: "ordered", reason: null });
    expect(zinc.posts).toEqual([expect.objectContaining({ city: "Akron" })]);
  });

  it("an address_rejected gift re-bought to the buyer ships to the buyer, with the shared address still present", async () => {
    const userId = await newUser();
    const r = await newRound(userId);
    // A list owner shares their address for this person.
    const owner = await newUser();
    await pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
       values ($1, 'Sam', 'Rivera', '44 Shared St', 'Akron', 'OH', '44301', true)`,
      [owner],
    );
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner]);
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      r.personId,
      userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);
    await pg.query("update public.people set linked_user_id = $2 where id = $1", [r.personId, owner]);
    await pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip)
       values ($1, 'Bo', 'Buyer', '5 Home Rd', 'Columbus', 'OH', '43215')`,
      [userId],
    );
    const [failed] = await boughtAndFailed(userId, r, { 0: "invalid_shipping_address" });
    expect((await orders(r.roundId))[0]).toMatchObject({ status: "failed", failure_type: "address_rejected", address_source: "shared" });
    zinc.posts = [];

    // Never back to the recipient: the shared address is still there.
    expect(await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0] }, deps())).toEqual({
      ok: false,
      error: "no_address",
    });
    expect(
      await replaceFailedOrder({ userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[0], shipTo: { kind: "buyer" } }, deps()),
    ).toEqual({ ok: true, status: "ordered", reason: null });
    const fresh = (await orders(r.roundId))[1];
    expect(fresh).toMatchObject({ idea_id: r.ideaIds[0], status: "placing", ship_to: "buyer", address_source: "own" });
    expect(zinc.posts).toEqual([expect.objectContaining({ ref: fresh.id, city: "Columbus" })]);
    const shared = await pg.query("select share_for_gifts from public.account_addresses where user_id = $1", [owner]);
    expect(shared.rows[0].share_for_gifts).toBe(true);
  });

  it("a relink while a replacement is bought is busy; the next one records the new owner (AC-1)", async () => {
    const userId = await newUser();
    const r = await newRound(userId, { totals: [3000, 2000] });
    /** A list owner sharing an address in `city`, and the person linked to their list. */
    const linkTo = async (city: string) => {
      const owner = await newUser();
      await pg.query(
        `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
         values ($1, 'Sam', 'Rivera', '44 Shared St', $2, 'OH', '44301', true)`,
        [owner, city],
      );
      const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner]);
      await pg.query("delete from lists.person_links where person_id = $1", [r.personId]);
      await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
        r.personId,
        userId,
        list.rows[0].id,
        list.rows[0].share_token,
      ]);
      return owner;
    };
    const first = await linkTo("Akron");
    const [failed] = await boughtAndFailed(userId, r, { 0: "out_of_stock" });
    expect((await pg.query("select address_owner_id from concierge.orders where id = $1", [failed])).rows).toEqual([{ address_owner_id: first }]);
    zinc.posts = [];

    // The buyer relinks the person right after the replacement read the shared address.
    let second: string | null = null;
    const real = deps().db;
    const racing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "rpc") return Reflect.get(target, prop, receiver);
        return async (fn: string, args: Record<string, unknown>) => {
          const res = await (target.rpc as (f: string, a: unknown) => PromiseLike<unknown>).call(target, fn, args);
          if (fn === "shared_address_for_person" && second === null) second = await linkTo("Toledo");
          return res;
        };
      },
    });
    const input = { userId, roundId: r.roundId, failedOrderId: failed, ideaId: r.ideaIds[1] };
    expect(await replaceFailedOrder(input, deps({ db: racing }))).toEqual({ ok: false, error: "busy" });
    expect(await orders(r.roundId)).toHaveLength(1);
    expect(zinc.posts).toEqual([]);

    // Bought again, it goes to the owner the person links to now, and says so.
    expect(await replaceFailedOrder(input, deps())).toEqual({ ok: true, status: "ordered", reason: null });
    const fresh = await pg.query("select address_owner_id from concierge.orders where round_id = $1 and idea_id = $2", [r.roundId, r.ideaIds[1]]);
    expect(fresh.rows).toEqual([{ address_owner_id: second }]);
    expect(zinc.posts).toEqual([expect.objectContaining({ city: "Toledo" })]);
  });
});
