// The Zinc and engine wiring (ALL-32 Task 7) against the real local Supabase and the real
// engine (E5: nothing of ours is mocked). Zinc's address points nowhere: these paths only tell
// the buyer and never call Zinc. Skipped when the local stack isn't running; fails in CI then.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "@/test/local-db";

// Next's guard that keeps this module out of browser code; not something of ours.
vi.mock("server-only", () => ({}));

const stack = await localStack({ api: true });
const supabase = stack?.supabase ?? null;

// Nothing listens on port 9 (discard), so a Zinc call would fail fast instead of reaching anyone.
const base = { ZINC_ENV: "live", ZINC_API_BASE: "http://127.0.0.1:9", ZINC_WALLET_URL: "https://app.zinc.test/wallet" };

describe.skipIf(!supabase)("Zinc and engine wiring (real local database and engine)", () => {
  let pg: Client;
  let wiring: typeof import("@/lib/wiring");
  const users: string[] = [];
  const envBefore = { ...process.env };
  // The switches these tests read, set here rather than trusted from the shared database, and put
  // back after. Buying on: with it off, a funds hold is silenced and its notice never goes.
  const SHARED: Record<string, string> = { zinc_ordering_enabled: "1", round_engine_enabled: "0", idea_engine_enabled: "0" };
  const settingsBefore = new Map<string, string>();

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const [key, value] of Object.entries(SHARED)) {
      settingsBefore.set(key, (await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
      await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    }
    // What the app reads from its environment, pointed at the local stack. Set before the
    // import, because the admin client reads its key when its module loads.
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: supabase!.url,
      SUPABASE_SECRET_KEY: supabase!.serviceRoleKey,
      EMAIL_OUTBOX: "log",
      ...base,
    });
    wiring = await import("@/lib/wiring");
  });
  afterAll(async () => {
    process.env = envBefore;
    for (const [key, value] of settingsBefore) await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  const setting = async (key: string) => Number((await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
  const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

  it("registers webhooks on the site's own address, not on whatever host the request used", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();
    const preview = await wiring.zincWiring(db, { ...base, VERCEL_ENV: "preview", VERCEL_URL: "gift-abc.vercel.app" });
    expect(preview?.deps.webhookBaseUrl).toBe("https://gift-abc.vercel.app");
    const prod = await wiring.zincWiring(db, {
      ...base,
      VERCEL_ENV: "production",
      VERCEL_URL: "gift-abc.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "giftsaf.com",
    });
    expect(prod?.deps.webhookBaseUrl).toBe("https://giftsaf.com");
    expect(prod?.walletUrl).toBe("https://app.zinc.test/wallet");
    expect(prod?.deps.http).toMatchObject({ base: "http://127.0.0.1:9", timeoutMs: await setting("zinc_timeout_ms") });
  });

  it("is off unless the environment, API address and wallet address are all set", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();
    expect(await wiring.zincWiring(db, { ...base, ZINC_ENV: "staging" })).toBeNull();
    expect(await wiring.zincWiring(db, { ...base, ZINC_API_BASE: undefined })).toBeNull();
    expect(await wiring.zincWiring(db, { ...base, ZINC_WALLET_URL: undefined })).toBeNull();
    expect(await wiring.zincWiring(db, {})).toBeNull();
  });

  it("gives Stripe a test key only with ZINC_ENV test, and a live key only with live", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();
    const test = await wiring.stripeWiring(db, { ZINC_ENV: "test", STRIPE_SECRET_KEY: "sk_test_x" });
    expect(test).toMatchObject({ key: "sk_test_x", mode: "test", timeoutMs: await setting("stripe_timeout_ms") });
    expect(await wiring.stripeWiring(db, { ZINC_ENV: "live", STRIPE_SECRET_KEY: "sk_live_x" })).toMatchObject({ mode: "live" });
    expect(await wiring.stripeWiring(db, { ZINC_ENV: "test", STRIPE_SECRET_KEY: "sk_live_x" })).toBeNull();
    expect(await wiring.stripeWiring(db, { ZINC_ENV: "live", STRIPE_SECRET_KEY: "sk_test_x" })).toBeNull();
    expect(await wiring.stripeWiring(db, { ZINC_ENV: "test", STRIPE_SECRET_KEY: "rk_test_x" })).toBeNull();
    expect(await wiring.stripeWiring(db, { ZINC_ENV: "test" })).toBeNull();
    expect(await wiring.stripeWiring(db, { STRIPE_SECRET_KEY: "sk_test_x" })).toBeNull();
  });

  it("gives the engine the real buying side, with the fee and margin from app_settings", async () => {
    const { engine, purchase } = await wiring.buyingWiring(new Date("2030-01-01T00:00:00Z"), { ...base, EMAIL_OUTBOX: "log" });
    expect(engine.zinc?.walletUrl).toBe("https://app.zinc.test/wallet");
    expect(engine.reactions).toBeTypeOf("function");
    expect(purchase).toMatchObject({
      env: "live",
      settings: { feeCents: await setting("zinc_order_fee_cents"), marginPct: await setting("order_price_margin_pct") },
    });
    expect(purchase?.now).toEqual(new Date("2030-01-01T00:00:00Z"));
  });

  it("runs the engine without Zinc, logging zinc.wiring_missing (ids only), when Zinc is off here", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { engine, purchase } = await wiring.buyingWiring(new Date(), { EMAIL_OUTBOX: "log" }, { user_id: "user-1" });
    expect(engine.zinc).toBeNull();
    expect(engine.reactions).toBeTypeOf("function");
    expect(purchase).toBeNull();
    expect(events(log).filter((e) => e.event === "zinc.wiring_missing")).toEqual([
      expect.objectContaining({ event: "zinc.wiring_missing", user_id: "user-1" }),
    ]);
    log.mockRestore();
  });

  // What a round message's job gets: the wallet side for the heads-up, and nothing that places.
  it("AC-12: gives a round message the wallet side only", async () => {
    const deps = await wiring.roundWiring(new Date("2030-01-01T00:00:00Z"), { ...base, EMAIL_OUTBOX: "log" }, 2);
    expect(Object.keys(deps.zinc!).sort()).toEqual(["lookahead", "wallet", "walletUrl"]);
    expect(deps.zinc!.walletUrl).toBe("https://app.zinc.test/wallet");
    expect(deps.now).toEqual(new Date("2030-01-01T00:00:00Z"));
  });

  /** Every request for this setting fails; everything else reaches the real database. */
  function unreadable(key: string) {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input, init) => {
      if (String(input).includes("/rpc/setting_int") && String(init?.body).includes(`"${key}"`)) {
        return new Response('{"message":"down"}', { status: 500 });
      }
      return real(input, init);
    }) satisfies typeof fetch);
  }

  it.each(["order_price_margin_pct", "zinc_order_fee_cents"])("AC-12: a round message's wiring doesn't read %s, which the buying side needs", async (key) => {
    unreadable(key);
    try {
      await expect(wiring.roundWiring(new Date(), { ...base, EMAIL_OUTBOX: "log" }, 1)).resolves.toMatchObject({
        zinc: { walletUrl: "https://app.zinc.test/wallet" },
      });
      await expect(wiring.buyingWiring(new Date(), { ...base, EMAIL_OUTBOX: "log" })).rejects.toThrow(key);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a round message's wiring throws when zinc_timeout_ms can't be read, so nothing is claimed", async () => {
    unreadable("zinc_timeout_ms");
    try {
      await expect(wiring.roundWiring(new Date(), { ...base, EMAIL_OUTBOX: "log" }, 1)).rejects.toThrow("zinc_timeout_ms");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AC-12, AC-14: with Zinc off a round message has none and logs nothing; a buyer message says so", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await wiring.roundWiring(new Date(), { EMAIL_OUTBOX: "log" }, 1)).zinc).toBeNull();
      expect(events(log).filter((e) => e.event === "zinc.wiring_missing")).toEqual([]);
      await wiring.buyingWiring(new Date(), { EMAIL_OUTBOX: "log" }, {}, { zincShare: 1 });
      expect(events(log).filter((e) => e.event === "zinc.wiring_missing")).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it.each([0, 1.5])("refuses a zincShare of %s, for both kinds of message", async (zincShare) => {
    await expect(wiring.roundWiring(new Date(), { EMAIL_OUTBOX: "log" }, zincShare)).rejects.toThrow("zincShare must be at least 1.");
    await expect(wiring.buyingWiring(new Date(), { EMAIL_OUTBOX: "log" }, {}, { zincShare })).rejects.toThrow("zincShare must be at least 1.");
  });

  /** A needs_attention/funds round whose notice hasn't gone, as approval leaves it. */
  async function heldRound(): Promise<string> {
    const userId = randomUUID();
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, `wiring-${userId}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [userId]);
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'Mary', 'friend') returning id", [userId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      userId,
      person.rows[0].id,
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + 40, current_date + 30, 20000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [userId, person.rows[0].id, occasion.rows[0].id],
    );
    const roundId = round.rows[0].id as string;
    const idea = await pg.query(
      "insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank) values ($1, $2, 'Mug', 4000, 4200, 1) returning id",
      [userId, roundId],
    );
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [roundId])).rows[0].locked_until;
    const orders = [
      {
        idea_id: idea.rows[0].id,
        max_price_cents: 4520,
        fee_cents: 100,
        ship_to: "recipient",
        address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
      },
    ];
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [roundId, userId, lock, JSON.stringify(orders)]);
    await pg.query("select concierge.release_round($1, $2)", [roundId, lock]);
    await pg.query("select concierge.hold_orders($1, 'funds')", [roundId]);
    return roundId;
  }
  const sends = async (roundId: string) => (await pg.query("select step from concierge.round_sends where round_id = $1", [roundId])).rows.map((r) => r.step);

  it("the webhook only tells the buyer: the hold notice goes at once, and nothing is placed inside Zinc's request", async () => {
    const roundId = await heldRound();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await wiring.webhookTellers().advanceRound(roundId)).toBe("advanced");
    log.mockRestore();
    expect(await sends(roundId)).toEqual(["hold:1:notice"]);
    const order = await pg.query("select status from concierge.orders where round_id = $1", [roundId]);
    expect(order.rows[0].status).toBe("held");
  });

  it("an approval or a re-try tells the buyer the same way, with the round engine switched off too (S6)", async () => {
    await pg.query("update concierge.app_settings set value = '0' where key = 'round_engine_enabled'");
    const roundId = await heldRound();
    const { purchase } = await wiring.buyingWiring(new Date(), { ...base, EMAIL_OUTBOX: "log" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await purchase!.advanceRound(roundId)).toBe("advanced");
    log.mockRestore();
    expect(await sends(roundId)).toEqual(["hold:1:notice"]);
  });

  // ALL-27. Nothing here reaches the AI Gateway or Zinc: the addresses point nowhere.
  const ideaEnv = { ...base, AI_GATEWAY_BASE: "http://127.0.0.1:9", AI_GATEWAY_API_KEY: "gw-test", ZINC_API_KEY: "zn-test", EMAIL_OUTBOX: "log" };
  const round = { id: randomUUID(), userId: randomUUID(), personId: randomUUID() };

  it.each(["AI_GATEWAY_BASE", "AI_GATEWAY_API_KEY", "ZINC_API_BASE", "ZINC_API_KEY"])(
    "with %s missing, idea runs fail without spending and say so (ids only)",
    async (key) => {
      const { engine } = await wiring.buyingWiring(new Date(), { ...ideaEnv, [key]: undefined });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(await engine.generateIdeas(round, AbortSignal.timeout(1000))).toEqual({ status: "failed" });
        const told = events(log).filter((e) => e.event === "ideas.not_configured");
        expect(told).toEqual([
          expect.objectContaining({ round_id: round.id, user_id: round.userId, person_id: round.personId, alert: true }),
        ]);
        expect(JSON.stringify(told)).not.toContain("gw-test");
        expect(JSON.stringify(told)).not.toContain("zn-test");
      } finally {
        log.mockRestore();
      }
    },
  );

  it("configured, idea runs go through the real idea engine, which is off as it ships", async () => {
    await pg.query("update concierge.app_settings set value = '0' where key = 'idea_engine_enabled'");
    const { engine } = await wiring.buyingWiring(new Date(), ideaEnv);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await engine.generateIdeas(round, AbortSignal.timeout(1000))).toEqual({ status: "off" });
      expect(events(log).filter((e) => e.event === "ideas.not_configured")).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it("placeHeld places nothing and says so once, with the user id, when Zinc is off here", async () => {
    const zincEnv = process.env.ZINC_ENV;
    delete process.env.ZINC_ENV;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await wiring.placeHeld("user-1");
      const missing = events(log).filter((e) => e.event === "zinc.wiring_missing");
      expect(missing).toEqual([expect.objectContaining({ user_id: "user-1" })]);
    } finally {
      log.mockRestore();
      process.env.ZINC_ENV = zincEnv;
    }
  });
});
