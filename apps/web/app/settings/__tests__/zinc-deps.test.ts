// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";

vi.mock("server-only", () => ({}));
import { zincWiring } from "../zinc-deps";

// Only the timeout setting is read; this stands in for the one rpc call.
const db = { schema: () => ({ rpc: async () => ({ data: 15000, error: null }) }) } as unknown as SupabaseClient<Database>;
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
