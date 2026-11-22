// The Amazon paste lookup's daily allowance against the real local database (E5, money,
// ALL-141): the server action takes lists.take_amazon_lookup through the signed-in
// person's own client, the first `limit` lookups reach Zinc, the next is over_limit and
// Zinc is never called for it. Zinc itself is faked (we don't own it). Skipped when the
// local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
let current: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));

const { lookUpAmazon } = await import("../actions/amazon-lookup");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

const ZINC = "https://zinc.test";
const ASIN = "B0G5Z36T3N";

describe.skipIf(!dbUp)("Amazon paste lookups on local Supabase", () => {
  const s = stack?.supabase;
  const admin = s
    ? createClient(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const users: string[] = [];
  const realFetch = globalThis.fetch;
  let zincCalls = 0;

  async function signedInClient(): Promise<SupabaseClient> {
    const email = `amazon-lookup-${randomUUID()}@example.test`;
    const password = "local-only-password";
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return db;
  }

  beforeEach(() => {
    zincCalls = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("ZINC_API_BASE", ZINC);
    vi.stubEnv("ZINC_API_KEY", "zn_test_LOCAL_DB");
    // Only Zinc is faked: every other request (Supabase's API) goes through.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(ZINC)) return realFetch(input, init);
      zincCalls++;
      return new Response(
        JSON.stringify({ status: "completed", product_id: ASIN, title: "Headband", main_image: null, price: 1195 }),
        { status: 200 },
      );
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });

  it("lets the first `limit` lookups reach Zinc, then stops without calling it", async () => {
    current = await signedInClient();
    const { data: limit, error } = await current.schema("concierge").rpc("setting_int", {
      p_key: "amazon_paste_lookups_per_user_per_day",
    });
    expect(error).toBeNull();
    expect(limit).toBeGreaterThan(0);

    for (let i = 0; i < (limit as number); i++) {
      expect(await lookUpAmazon(ASIN)).toMatchObject({ ok: true, product: { productId: ASIN, priceCents: 1195 } });
    }
    expect(zincCalls).toBe(limit);

    expect(await lookUpAmazon(ASIN)).toEqual({ ok: false, reason: "over_limit" });
    expect(zincCalls).toBe(limit);
  });

  it("counts each person separately", async () => {
    current = await signedInClient();
    expect(await lookUpAmazon(ASIN)).toMatchObject({ ok: true });
    expect(zincCalls).toBe(1);
  });
});
