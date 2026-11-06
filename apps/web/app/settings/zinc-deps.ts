import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  advanceRound,
  createStubGenerateIdeas,
  createSupabaseNotifyStore,
  createSupabaseRoundStore,
  defaultChannels,
  fundingLookahead,
  getZincWallet,
  placeHeldForUser,
  placeRound,
  sweepStalePlacing,
  type EngineDeps,
  type PlaceHeld,
  type PurchaseDeps,
  type ZincDeps,
} from "@/modules/concierge";

type Env = Record<string, string | undefined>;

// Where ZINC_ENV, ZINC_API_BASE and ZINC_WALLET_URL are read (E3): the module logic only sees `deps`.
// Anything missing, or ZINC_ENV not "test" or "live", means Zinc is off in this environment.
// The webhook address Zinc is told about is the site's own (siteUrl), never the request's Host,
// so a preview or vercel.app address can't end up registered.
export async function zincWiring(
  db: SupabaseClient<Database>,
  env: Env = process.env,
): Promise<{ deps: ZincDeps; walletUrl: string } | null> {
  const zincEnv = env.ZINC_ENV;
  const base = env.ZINC_API_BASE;
  const walletUrl = env.ZINC_WALLET_URL;
  if ((zincEnv !== "test" && zincEnv !== "live") || !base || !walletUrl) return null;
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "zinc_timeout_ms" });
  if (error || typeof data !== "number") throw new Error("Reading setting zinc_timeout_ms failed.");
  return {
    deps: { db, http: { base, timeoutMs: data, fetch }, env: zincEnv, webhookBaseUrl: siteUrl(env), now: new Date() },
    walletUrl,
  };
}

async function settingInt(db: SupabaseClient<Database>, key: string): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error || typeof data !== "number") throw new Error(`Reading setting ${key} failed.`);
  return data;
}

/**
 * The round engine and the buying side, wired to each other (ALL-32 Task 7): the engine
 * places held rounds and sweeps through the real placeRound and sweepStalePlacing, and an
 * approval or webhook tells the buyer through the engine's advanceRound. With Zinc off here
 * (`purchase` null) the engine still runs and sends emails, but nothing is placed, and
 * `zinc.wiring_missing` is logged so the owner sees it.
 */
export async function buyingWiring(
  now: Date,
  env: Env = process.env,
): Promise<{ engine: EngineDeps; purchase: PurchaseDeps | null }> {
  const db = createAdminClient();
  const engine: EngineDeps = {
    store: createSupabaseRoundStore(db),
    notify: { store: createSupabaseNotifyStore(db), channels: defaultChannels(env), baseUrl: siteUrl(env), now },
    now,
    generateIdeas: createStubGenerateIdeas({ production: env.VERCEL_ENV === "production" }),
    zinc: null,
  };
  const wiring = await zincWiring(db, env);
  if (!wiring) {
    logEvent("zinc.wiring_missing", {});
    return { engine, purchase: null };
  }
  const zinc: ZincDeps = { ...wiring.deps, now };
  const [feeCents, marginPct] = await Promise.all([
    settingInt(db, "zinc_order_fee_cents"),
    settingInt(db, "order_price_margin_pct"),
  ]);
  const purchase: PurchaseDeps = {
    ...zinc,
    settings: { feeCents, marginPct },
    // Approval has just tried placing; the engine only tells the buyer.
    advanceRound: (roundId) => advanceRound(roundId, engine, { justPlaced: true }),
  };
  engine.zinc = {
    placeRound: (roundId, lock) => placeRound(roundId, lock, purchase),
    sweep: () => sweepStalePlacing(purchase),
    wallet: (userId) => getZincWallet(userId, zinc),
    lookahead: (userId, days, fee) => fundingLookahead(userId, zinc, fee, days),
    walletUrl: wiring.walletUrl,
  };
  return { engine, purchase };
}

/**
 * Tries a user's held gifts again: after setup is finished, the phone saved, an address saved,
 * or Zinc's auto top-up worked. With Zinc off here, nothing is placed and it's logged.
 */
export const placeHeld: PlaceHeld = async (userId) => {
  const { purchase } = await buyingWiring(new Date());
  if (!purchase) {
    logEvent("zinc.wiring_missing", { user_id: userId });
    return;
  }
  await placeHeldForUser(userId, purchase);
};
