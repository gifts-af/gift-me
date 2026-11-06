// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";

vi.mock("server-only", () => ({}));
// Only settings are read while wiring (every one answers 15000 here); this stands in for those rpc calls.
const db = vi.hoisted(() => ({ schema: () => ({ rpc: async () => ({ data: 15000, error: null }) }) })) as unknown as SupabaseClient<Database>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
// Spies on the engine's entry points; the engine itself is tested against the real database.
const engine = vi.hoisted(() => ({ advanceRound: vi.fn(async () => "advanced"), tellOrdered: vi.fn(async () => {}) }));
vi.mock("@/modules/concierge", async (original) => ({ ...(await original<object>()), ...engine }));
import { buyingWiring, placeHeld, webhookTellers, zincWiring } from "../zinc-deps";
const base = { ZINC_ENV: "live", ZINC_API_BASE: "https://api.zinc.test", ZINC_WALLET_URL: "https://app.zinc.test/wallet" };

describe("zincWiring", () => {
  it("registers webhooks on the site's own address, not on whatever host the request used (ALL-32)", async () => {
    const preview = await zincWiring(db, { ...base, VERCEL_ENV: "preview", VERCEL_URL: "gift-abc.vercel.app" });
    expect(preview?.deps.webhookBaseUrl).toBe("https://gift-abc.vercel.app");
    const prod = await zincWiring(db, {
      ...base,
      VERCEL_ENV: "production",
      VERCEL_URL: "gift-abc.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "giftsaf.com",
    });
    expect(prod?.deps.webhookBaseUrl).toBe("https://giftsaf.com");
    expect(prod?.walletUrl).toBe("https://app.zinc.test/wallet");
    expect(prod?.deps.http).toMatchObject({ base: "https://api.zinc.test", timeoutMs: 15000 });
  });

  it("is off unless the environment, API address and wallet address are all set", async () => {
    expect(await zincWiring(db, { ...base, ZINC_ENV: "staging" })).toBeNull();
    expect(await zincWiring(db, { ...base, ZINC_API_BASE: undefined })).toBeNull();
    expect(await zincWiring(db, { ...base, ZINC_WALLET_URL: undefined })).toBeNull();
    expect(await zincWiring(db, {})).toBeNull();
  });
});

describe("buyingWiring (ALL-32 Task 7)", () => {
  const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])).event);

  it("gives the engine the real buying side when Zinc is on here", async () => {
    const { engine, purchase } = await buyingWiring(new Date("2030-01-01T00:00:00Z"), { ...base, EMAIL_OUTBOX: "log" });
    expect(engine.zinc?.walletUrl).toBe("https://app.zinc.test/wallet");
    expect(purchase).toMatchObject({ env: "live", settings: { feeCents: 15000, marginPct: 15000 } });
    expect(purchase?.now).toEqual(new Date("2030-01-01T00:00:00Z"));
  });

  it("runs the engine without Zinc, logging zinc.wiring_missing (ids only), when Zinc is off here", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { engine, purchase } = await buyingWiring(new Date(), { EMAIL_OUTBOX: "log" });
    expect(engine.zinc).toBeNull();
    expect(purchase).toBeNull();
    expect(events(log)).toContain("zinc.wiring_missing");
    log.mockRestore();
  });

  it("the webhook only tells the buyer: advanceRound with justPlaced, never a place inside Zinc's request", async () => {
    const tellers = webhookTellers();
    await tellers.advanceRound("round-1");
    expect(engine.advanceRound).toHaveBeenCalledWith("round-1", expect.anything(), { justPlaced: true });
    await tellers.orderPlaced("round-2");
    expect(engine.tellOrdered).toHaveBeenCalledWith("round-2", expect.anything());
  });

  it("an approval or a re-try tells the buyer the same way (justPlaced)", async () => {
    const { purchase } = await buyingWiring(new Date(), { ...base, EMAIL_OUTBOX: "log" });
    engine.advanceRound.mockClear();
    await purchase!.advanceRound("round-3");
    expect(engine.advanceRound).toHaveBeenCalledWith("round-3", expect.anything(), { justPlaced: true });
  });

  it("placeHeld places nothing and says so once, with the user id, when Zinc is off here", async () => {
    const before = { ...process.env };
    delete process.env.ZINC_ENV;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await placeHeld("user-1");
    const missing = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "zinc.wiring_missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ user_id: "user-1" });
    log.mockRestore();
    process.env = before;
  });
});
