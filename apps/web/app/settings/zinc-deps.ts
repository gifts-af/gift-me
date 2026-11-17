import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  advanceRound,
  clearUnfiledNotes,
  createSupabaseIdeaStore,
  createSupabaseNotifyStore,
  createSupabaseRoundStore,
  defaultChannels,
  fundingLookahead,
  tellOrdered,
  getZincWallet,
  placeAddressHeldFor,
  placeHeldForUser,
  placeRound,
  runIdeas,
  sweepStalePlacing,
  type EngineDeps,
  type GenerateIdeas,
  type PlaceAddressHeld,
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
 * The tick's idea runs (ALL-27): runIdeas with the AI Gateway (AI_GATEWAY_BASE, AI_GATEWAY_API_KEY)
 * and Zinc's product lookups on the app's own key (ZINC_API_BASE, ZINC_API_KEY, T17). With any of
 * them missing here, every run fails without spending, and `ideas.not_configured` says why.
 */
function ideaWiring(db: SupabaseClient<Database>, env: Env, now: Date): GenerateIdeas {
  const gatewayBase = env.AI_GATEWAY_BASE;
  const gatewayKey = env.AI_GATEWAY_API_KEY;
  const zincBase = env.ZINC_API_BASE;
  const zincKey = env.ZINC_API_KEY;
  if (!gatewayBase || !gatewayKey || !zincBase || !zincKey) {
    return async (round) => {
      logEvent("ideas.not_configured", { round_id: round.id, user_id: round.userId, person_id: round.personId });
      return { status: "failed" };
    };
  }
  const store = createSupabaseIdeaStore(db);
  return async (round, signal) => {
    const timeoutMs = await settingInt(db, "idea_zinc_timeout_ms");
    return runIdeas(
      { userId: round.userId, personId: round.personId, roundId: round.id, signal },
      {
        store,
        gateway: { base: gatewayBase, apiKey: gatewayKey, fetch },
        zinc: { http: { base: zincBase, timeoutMs, fetch }, key: zincKey },
        // The engine's day: the tick's UTC day.
        today: now.toISOString().slice(0, 10),
        clock: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
    );
  };
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
  ids: { user_id?: string } = {},
): Promise<{ engine: EngineDeps; purchase: PurchaseDeps | null }> {
  const db = createAdminClient();
  const engine: EngineDeps = {
    store: createSupabaseRoundStore(db),
    notify: { store: createSupabaseNotifyStore(db), channels: defaultChannels(env), baseUrl: siteUrl(env), now },
    now,
    generateIdeas: ideaWiring(db, env, now),
    zinc: null,
    clearUnfiledNotes: () => clearUnfiledNotes(db),
  };
  const wiring = await zincWiring(db, env);
  if (!wiring) {
    logEvent("zinc.wiring_missing", ids);
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
    // The caller has just tried placing; the engine only tells the buyer.
    advanceRound: (roundId) => advanceRound(roundId, engine, { justPlaced: true }),
    orderPlaced: (roundId) => tellOrdered(roundId, engine),
  };
  engine.zinc = {
    // The tick's one placing deadline (engine and purchase both read Date.now).
    placeRound: (roundId, lock, deadlineMs, opts) => placeRound(roundId, lock, purchase, { deadlineMs, ...opts }),
    sweep: () => sweepStalePlacing(purchase),
    wallet: (userId) => getZincWallet(userId, zinc),
    lookahead: (userId, days, fee) => fundingLookahead(userId, zinc, fee, days),
    walletUrl: wiring.walletUrl,
  };
  return { engine, purchase };
}

/**
 * How a webhook tells the buyer at once (owner: customers are always told): a settlement that
 * needs them through advanceRound with justPlaced, so the engine only emails and never places
 * inside Zinc's request; an order Zinc placed through tellOrdered.
 */
export function webhookTellers(): { advanceRound: (roundId: string) => Promise<unknown>; orderPlaced: (roundId: string) => Promise<unknown> } {
  return {
    advanceRound: async (roundId) => advanceRound(roundId, (await buyingWiring(new Date())).engine, { justPlaced: true }),
    orderPlaced: async (roundId) => tellOrdered(roundId, (await buyingWiring(new Date())).engine),
  };
}

/**
 * Tries a user's held gifts again: after setup is finished, the phone saved, an address saved,
 * or Zinc's auto top-up worked. With Zinc off here, nothing is placed and it's logged.
 */
export const placeHeld: PlaceHeld = async (userId) => {
  // buyingWiring logs zinc.wiring_missing (with the user id) when Zinc is off here.
  const { purchase } = await buyingWiring(new Date(), process.env, { user_id: userId });
  if (purchase) await placeHeldForUser(userId, purchase);
};

/** After a person's address is saved: places that person's gifts held for an address (ALL-32 S10). */
export const placeAddressHeld: PlaceAddressHeld = async (userId, personId) => {
  const { purchase } = await buyingWiring(new Date(), process.env, { user_id: userId });
  if (purchase) await placeAddressHeldFor(userId, personId, purchase);
};
