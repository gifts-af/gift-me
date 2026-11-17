// @vitest-environment node
// The Supabase IdeaStore and onDemandIdeas (ALL-27 Task 6) on the real local database (E5):
// the service-role client for the store, and a signed-in user's client for what the screen
// reads, so RLS is the real thing. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { SavedIdea } from "../ideas/store";

vi.mock("server-only", () => ({}));
const { onDemandIdeas } = await import("../ideas/read");
const { createSupabaseIdeaStore } = await import("../ideas/store");
const { runIdeas } = await import("../ideas/run");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

const idea = (o: Partial<SavedIdea> = {}): SavedIdea => ({
  title: "Acme fly rod",
  retailer: "amazon",
  productUrl: "https://www.amazon.com/dp/B0ROD",
  retailerProductId: "B0ROD",
  offerId: "offer-1",
  sellerName: "Amazon",
  firstParty: true,
  priceCents: 2000,
  estShippingCents: 500,
  estTaxCents: 160,
  estTotalCents: 2760,
  handlingDaysMax: 1,
  deliveryDaysMin: 2,
  deliveryDaysMax: 4,
  arriveBy: "2026-11-22",
  reason: "He fishes every weekend",
  overBudget: false,
  rank: 1,
  ...o,
});

describe.skipIf(!dbUp)("createSupabaseIdeaStore", () => {
  const s = stack?.supabase;
  const admin = s
    ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const store = () => createSupabaseIdeaStore(admin!);
  const password = "local-only-password";
  let pg: Client;
  const users: string[] = [];

  async function newUser(displayName: string): Promise<{ id: string; email: string }> {
    const email = `idea-store-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw error;
    users.push(data.user.id);
    await pg.query("insert into concierge.accounts (user_id, paid_features, over_budget_pct) values ($1, true, 20)", [
      data.user.id,
    ]);
    return { id: data.user.id, email };
  }

  async function newPerson(userId: string, name: string): Promise<string> {
    return (
      await pg.query("insert into public.people (user_id, name, relationship) values ($1, $2, 'father') returning id", [
        userId,
        name,
      ])
    ).rows[0].id as string;
  }

  async function addFact(userId: string, personId: string, value: string, active = true) {
    await pg.query(
      `insert into concierge.profile_facts (user_id, person_id, category, value, source, active)
       values ($1, $2, 'interest', $3, 'question', $4)`,
      [userId, personId, value, active],
    );
  }

  async function signedIn(email: string) {
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return db;
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  it("settings reads every value it needs", async () => {
    const got = await store().settings();
    expect(typeof got.enabled).toBe("boolean");
    for (const [key, value] of Object.entries(got)) {
      if (key === "enabled" || key === "schedule") continue;
      expect(Number.isInteger(value), key).toBe(true);
    }
    expect(Number.isInteger(got.schedule.safetyBufferDays)).toBe(true);
  });

  it("inputs reads only active facts of a live person", async () => {
    const buyer = await newUser("Jim Burger");
    const person = await newPerson(buyer.id, "Bob Smith");
    await addFact(buyer.id, person, "Loves fishing");
    await addFact(buyer.id, person, "Turned off", false);

    const got = await store().inputs({ userId: buyer.id, personId: person, roundId: null });
    expect(got?.facts.map((f) => f.value)).toEqual(["Loves fishing"]);
    expect(got?.relationship).toBe("father");
    expect(got?.overBudgetPct).toBe(20);
    expect(got?.names).toEqual(["Burger", "Smith", "Bob", "Jim"]);

    // Another buyer's person, and a deleted one, aren't there at all.
    const other = await newUser("Someone Else");
    expect(await store().inputs({ userId: other.id, personId: person, roundId: null })).toBeNull();
    await pg.query("update public.people set deleted_at = now() where id = $1", [person]);
    expect(await store().inputs({ userId: buyer.id, personId: person, roundId: null })).toBeNull();
  });

  it("inputs uses the base budget when the occasion has none", async () => {
    const buyer = await newUser("Jim");
    const person = await newPerson(buyer.id, "Dad");
    await pg.query(
      "insert into concierge.occasions (user_id, person_id, kind, month, day) values ($1, $2, 'birthday', 12, 20)",
      [buyer.id, person],
    );
    await pg.query("insert into concierge.occasions (user_id, person_id, kind, enabled) values ($1, $2, 'christmas', false)", [
      buyer.id,
      person,
    ]);
    await pg.query("insert into concierge.budgets (user_id, person_id, occasion_kind, amount_cents) values ($1, $2, 'any', 4000)", [
      buyer.id,
      person,
    ]);
    await pg.query(
      "insert into concierge.budget_defaults (user_id, relationship, base_amount_cents) values ($1, 'father', 2500)",
      [buyer.id],
    );

    const got = await store().inputs({ userId: buyer.id, personId: person, roundId: null });
    expect(got?.occasions).toEqual([{ rule: { kind: "birthday", month: 12, day: 20 }, ownBudgetCents: null }]);
    expect(got?.baseBudgetCents).toBe(4000);
    expect(got?.defaultBudgetCents).toBe(2500);
    expect(got?.round).toBeNull();
  });

  it("start, progress and save round-trip a run", async () => {
    const buyer = await newUser("Jim");
    const person = await newPerson(buyer.id, "Dad");
    const req = { userId: buyer.id, personId: person, roundId: null };

    const started = await store().start(req, new Date());
    if (!("runId" in started)) throw new Error(`refused: ${started.refused}`);
    expect(await store().start(req, new Date())).toEqual({ refused: "busy" });

    await store().progress(started.runId, "brainstormed", 14);
    let run = (await pg.query("select stage, cost_cents, finished_at from concierge.idea_runs where id = $1", [started.runId])).rows[0];
    expect(run).toMatchObject({ stage: "brainstormed", cost_cents: 14, finished_at: null });

    const count = await store().save(started.runId, [
      idea(),
      idea({ title: "Tackle box", retailerProductId: "B0BOX", productUrl: "https://www.amazon.com/dp/B0BOX", overBudget: true, arriveBy: null, rank: 2 }),
    ]);
    expect(count).toBe(2);
    await store().finish(started.runId, "saved", 41);

    const rows = (
      await pg.query(
        `select title, retailer, product_url, retailer_product_id, offer_id, seller_name, first_party, price_cents,
                est_shipping_cents, est_tax_cents, est_total_cents, handling_days_max, delivery_days_min,
                delivery_days_max, arrive_by::text, reason, over_budget, rank, person_id, round_id, source, status
           from concierge.gift_ideas where person_id = $1 order by rank`,
        [person],
      )
    ).rows;
    expect(rows[0]).toEqual({
      title: "Acme fly rod",
      retailer: "amazon",
      product_url: "https://www.amazon.com/dp/B0ROD",
      retailer_product_id: "B0ROD",
      offer_id: "offer-1",
      seller_name: "Amazon",
      first_party: true,
      price_cents: 2000,
      est_shipping_cents: 500,
      est_tax_cents: 160,
      est_total_cents: 2760,
      handling_days_max: 1,
      delivery_days_min: 2,
      delivery_days_max: 4,
      arrive_by: "2026-11-22",
      reason: "He fishes every weekend",
      over_budget: false,
      rank: 1,
      person_id: person,
      round_id: null,
      source: "generated",
      status: "proposed",
    });
    expect(rows[1]).toMatchObject({ title: "Tackle box", over_budget: true, arrive_by: null, rank: 2 });

    run = (await pg.query("select outcome, cost_cents, finished_at from concierge.idea_runs where id = $1", [started.runId])).rows[0];
    expect(run.outcome).toBe("saved");
    expect(run.cost_cents).toBe(41);
    expect(run.finished_at).not.toBeNull();
  });

  it("excluded comes from excluded_products", async () => {
    const buyer = await newUser("Jim");
    const person = await newPerson(buyer.id, "Dad");
    await pg.query(
      `insert into concierge.gift_ideas (user_id, person_id, title, retailer_product_id, price_cents, est_total_cents, rank, status)
       values ($1, $2, 'Old kettle', 'B0REJ', 1000, 1000, 1, 'rejected'),
              ($1, $2, 'Still proposed', 'B0NEW', 1000, 1000, 2, 'proposed')`,
      [buyer.id, person],
    );
    const got = await store().inputs({ userId: buyer.id, personId: person, roundId: null });
    expect(got?.excluded).toEqual(["B0REJ"]);
    expect(got?.avoidTitles).toEqual(["Old kettle"]);
  });

  it("avoidTitles are this person's own, including old round ideas without a person", async () => {
    const buyer = await newUser("Jim");
    const dad = await newPerson(buyer.id, "Dad");
    const mom = await newPerson(buyer.id, "Mom");
    const occasion = (
      await pg.query(
        "insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id",
        [buyer.id, dad],
      )
    ).rows[0].id as string;
    const round = (
      await pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
         values ($1, $2, $3, 2025, '2025-12-25', '2025-12-16', 'skipped') returning id`,
        [buyer.id, dad, occasion],
      )
    ).rows[0].id as string;
    // The same product rejected for Mom, under a title naming her, and for Dad in an old round idea.
    await pg.query(
      `insert into concierge.gift_ideas (user_id, person_id, round_id, title, retailer_product_id, price_cents, est_total_cents, rank, status)
       values ($1, $2, null, 'Mug for Mom Allen', 'B0MUG', 1000, 1000, 1, 'rejected'),
              ($1, null, $3, 'Stoneware mug', 'B0MUG', 1000, 1000, 1, 'rejected')`,
      [buyer.id, mom, round],
    );
    const got = await store().inputs({ userId: buyer.id, personId: dad, roundId: null });
    expect(got?.excluded).toEqual(["B0MUG"]);
    expect(got?.avoidTitles).toEqual(["Stoneware mug"]);
  });

  // S4: the checks before a run, on the real store. Both vendors are spies that fail the test if
  // called, so nothing here can reach the AI Gateway or Zinc.
  async function runWithSpies(userId: string, personId: string) {
    const gateway = vi.fn(async () => new Response("{}", { status: 500 }));
    const zinc = vi.fn(async () => new Response("{}", { status: 500 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const outcome = await runIdeas(
        { userId, personId, roundId: null, signal: new AbortController().signal },
        {
          store: store(),
          gateway: { base: "http://127.0.0.1:9", apiKey: "gw-test", fetch: gateway as unknown as typeof fetch },
          zinc: { http: { base: "http://127.0.0.1:9", timeoutMs: 1000, fetch: zinc as unknown as typeof fetch }, key: "zn-test" },
          today: "2026-11-17",
          clock: Date.now,
          sleep: async () => {},
        },
      );
      const runs = await pg.query("select count(*)::int as n from concierge.idea_runs where person_id = $1", [personId]);
      return { outcome, gatewayCalls: gateway.mock.calls.length, zincCalls: zinc.mock.calls.length, runs: runs.rows[0].n as number };
    } finally {
      log.mockRestore();
    }
  }

  it("with idea_engine_enabled 0, or an unpaid buyer, a run calls no vendor and writes no idea_runs row", async () => {
    const before = (await pg.query("select value from concierge.app_settings where key = 'idea_engine_enabled'")).rows[0].value;
    try {
      const buyer = await newUser("Jim");
      const person = await newPerson(buyer.id, "Dad");
      await addFact(buyer.id, person, "Loves fishing");

      await pg.query("update concierge.app_settings set value = '0' where key = 'idea_engine_enabled'");
      expect(await runWithSpies(buyer.id, person)).toEqual({ outcome: { status: "off" }, gatewayCalls: 0, zincCalls: 0, runs: 0 });

      await pg.query("update concierge.app_settings set value = '1' where key = 'idea_engine_enabled'");
      const unpaid = await newUser("Unpaid");
      await pg.query("update concierge.accounts set paid_features = false where user_id = $1", [unpaid.id]);
      const theirs = await newPerson(unpaid.id, "Mum");
      await addFact(unpaid.id, theirs, "Loves gardening");
      expect(await runWithSpies(unpaid.id, theirs)).toEqual({
        outcome: { status: "refused", reason: "not_paid" },
        gatewayCalls: 0,
        zincCalls: 0,
        runs: 0,
      });
    } finally {
      await pg.query("update concierge.app_settings set value = $1 where key = 'idea_engine_enabled'", [before]);
    }
  });

  it("onDemandIdeas shows only the signed-in user's ideas", async () => {
    const buyer = await newUser("Jim");
    const stranger = await newUser("Stranger");
    const person = await newPerson(buyer.id, "Dad");
    const started = await store().start({ userId: buyer.id, personId: person, roundId: null }, new Date());
    if (!("runId" in started)) throw new Error(`refused: ${started.refused}`);
    await store().save(started.runId, [
      idea({ title: "Second", retailerProductId: "B0TWO", rank: 2, overBudget: true }),
      idea({ title: "First", rank: 1 }),
    ]);

    const mine = await onDemandIdeas(await signedIn(buyer.email), person);
    expect(mine.map((i) => i.title)).toEqual(["First", "Second"]);
    expect(mine[0]).toMatchObject({
      retailer: "amazon",
      productUrl: "https://www.amazon.com/dp/B0ROD",
      retailerProductId: "B0ROD",
      sellerName: "Amazon",
      totalCents: 2760,
      arriveBy: "2026-11-22",
      reason: "He fishes every weekend",
      overBudget: false,
    });
    expect(mine[1].overBudget).toBe(true);

    expect(await onDemandIdeas(await signedIn(stranger.email), person)).toEqual([]);
  });
});
