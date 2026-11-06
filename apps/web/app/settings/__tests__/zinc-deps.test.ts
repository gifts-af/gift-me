// @vitest-environment node
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
  let wiring: typeof import("../zinc-deps");
  const users: string[] = [];
  const envBefore = { ...process.env };
  const SHARED = ["round_engine_enabled"];
  const settingsBefore = new Map<string, string>();

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const key of SHARED) {
      settingsBefore.set(key, (await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
    }
    // What the app reads from its environment, pointed at the local stack. Set before the
    // import, because the admin client reads its key when its module loads.
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: supabase!.url,
      SUPABASE_SECRET_KEY: supabase!.serviceRoleKey,
      EMAIL_OUTBOX: "log",
      ...base,
    });
    wiring = await import("../zinc-deps");
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

  it("gives the engine the real buying side, with the fee and margin from app_settings", async () => {
    const { engine, purchase } = await wiring.buyingWiring(new Date("2030-01-01T00:00:00Z"), { ...base, EMAIL_OUTBOX: "log" });
    expect(engine.zinc?.walletUrl).toBe("https://app.zinc.test/wallet");
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
    expect(purchase).toBeNull();
    expect(events(log).filter((e) => e.event === "zinc.wiring_missing")).toEqual([
      expect.objectContaining({ event: "zinc.wiring_missing", user_id: "user-1" }),
    ]);
    log.mockRestore();
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
