import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarDate, Database } from "@gifts-af/core";
import { gatewayCredits } from "@/lib/ai/messages";
import { logEvent } from "@/lib/log";
import { sendEmail } from "@/lib/resend";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  advanceRound,
  clearUnfiledNotes,
  connectKey,
  costRecorder,
  pruneExpiredActionLinks,
  pruneTrackingNumbers,
  createSupabaseIdeaStore,
  createSupabaseNotifyStore,
  createSupabaseRoundStore,
  defaultChannels,
  fundingLookahead,
  tellOrdered,
  getWallet,
  getZincWallet,
  placeAddressHeldFor,
  placeHeldForUser,
  placeRound,
  runIdeas,
  runReactions,
  runTrackingNews,
  tellDelivered,
  sweepStalePlacing,
  type EngineDeps,
  type GenerateIdeas,
  type HealthDeps,
  type IdeaDeps,
  type PlaceAddressHeld,
  type PlaceHeld,
  type PurchaseDeps,
  type DbDeps,
  type ConnectKey,
  type QuoteDeps,
  type SendJobs,
  type StripeHttp,
  type StepDeps,
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

/**
 * Stripe, for saving a buyer's card: where STRIPE_SECRET_KEY is read (E3). Null unless a test key
 * goes with ZINC_ENV "test" or a live key with "live", so a test card can never meet a live Zinc
 * order or the other way round. Timed by stripe_timeout_ms.
 */
export async function stripeWiring(db: SupabaseClient<Database>, env: Env = process.env): Promise<StripeHttp | null> {
  const key = env.STRIPE_SECRET_KEY;
  const zincEnv = env.ZINC_ENV;
  if (!key) return null;
  const mode = key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : null;
  if (!mode || mode !== zincEnv) return null;
  const base = env.STRIPE_API_BASE;
  return { key, mode, timeoutMs: await settingInt(db, "stripe_timeout_ms"), fetch, ...(base ? { base } : {}) };
}

/**
 * Zinc Connect, for card orders: where ZINC_CONNECT_API_KEY and ZINC_CONNECT_WEBHOOK_SECRET are read
 * (E3). The key is the app's own on the owner's Zinc account, handed on only as a ConnectKey, which
 * only sendConnectOrder can send with. Null unless both are set and the key fits ZINC_ENV (a
 * `zn_test_` key with "test", any other with "live"), so a test key never meets a live order.
 */
export function connectWiring(env: Env = process.env): { key: ConnectKey; webhookSecret: string } | null {
  const key = env.ZINC_CONNECT_API_KEY;
  const webhookSecret = env.ZINC_CONNECT_WEBHOOK_SECRET;
  const zincEnv = env.ZINC_ENV;
  if (!key || !webhookSecret || (zincEnv !== "test" && zincEnv !== "live")) return null;
  if (key.startsWith("zn_test_") !== (zincEnv === "test")) return null;
  return { key: connectKey(key), webhookSecret };
}

/**
 * The round screen's deps (ALL-29): roundAccess, rejectionOutlook, rejectRoundIdeas,
 * setRoundBudget and quoteFailedOrder's own reads only use the service-role client and the
 * clock, so they work with Zinc off here too; their type gives them no way to reach Zinc.
 */
export function roundDbDeps(now: Date): DbDeps {
  return { db: createAdminClient(), now };
}

export async function settingInt(db: SupabaseClient<Database>, key: string): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error || typeof data !== "number") throw new Error(`Reading setting ${key} failed.`);
  return data;
}

/**
 * Zinc's product lookups on the app's own key (ZINC_API_BASE, ZINC_API_KEY, T17), timed by
 * idea_zinc_timeout_ms: the idea run's, and the fix page's price check (ALL-29 QuoteDeps.lookup).
 * Null when either is missing here.
 */
export async function lookupWiring(db: SupabaseClient<Database>, env: Env = process.env): Promise<QuoteDeps["lookup"] | null> {
  const base = env.ZINC_API_BASE;
  const key = env.ZINC_API_KEY;
  if (!base || !key) return null;
  return { http: { base, timeoutMs: await settingInt(db, "idea_zinc_timeout_ms"), fetch }, key };
}

/**
 * runIdeas' deps (ALL-27): the AI Gateway (AI_GATEWAY_BASE, AI_GATEWAY_API_KEY) and Zinc's
 * product lookups on the app's own key (ZINC_API_BASE, ZINC_API_KEY, T17). Null when any of
 * them is missing here, so the caller fails the run without spending and says why.
 */
async function ideaDeps(db: SupabaseClient<Database>, env: Env, today: CalendarDate, zincShare = 1): Promise<IdeaDeps | null> {
  const gatewayBase = env.AI_GATEWAY_BASE;
  const gatewayKey = env.AI_GATEWAY_API_KEY;
  if (!gatewayBase || !gatewayKey) return null;
  const zinc = await lookupWiring(db, env);
  if (!zinc) return null;
  return {
    store: createSupabaseIdeaStore(db),
    gateway: { base: gatewayBase, apiKey: gatewayKey, fetch },
    zinc,
    today,
    zincShare,
    clock: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    recordCost: costRecorder(() => db),
  };
}

/** The Gift ideas screen's run (suggestIdeasAction): the same deps, on the buyer's own day. */
export async function onDemandIdeaDeps(today: CalendarDate, env: Env = process.env): Promise<IdeaDeps | null> {
  return ideaDeps(createAdminClient(), env, today);
}

/**
 * The tick's idea runs. With the vendors not set up here, every run fails, uncounted, and
 * `ideas.not_configured` alerts (design/operations.md > Alerts): the rounds would otherwise go quiet.
 */
function ideaWiring(db: SupabaseClient<Database>, env: Env, now: Date, zincShare = 1): GenerateIdeas {
  return async (round, signal) => {
    // The engine's day: the tick's UTC day.
    const deps = await ideaDeps(db, env, now.toISOString().slice(0, 10), zincShare);
    if (!deps) {
      logEvent("ideas.not_configured", { round_id: round.id, user_id: round.userId, person_id: round.personId, alert: true });
      return { status: "failed" };
    }
    return runIdeas({ userId: round.userId, personId: round.personId, roundId: round.id, signal }, deps);
  };
}

/** What every round needs, whether or not its job can place a gift. */
function roundBase(now: Date, env: Env, zincShare: number): { db: SupabaseClient<Database>; base: Omit<StepDeps, "zinc"> } {
  if (!Number.isInteger(zincShare) || zincShare < 1) throw new Error("zincShare must be at least 1.");
  const db = createAdminClient();
  return {
    db,
    base: {
      store: createSupabaseRoundStore(db),
      notify: { store: createSupabaseNotifyStore(db), channels: defaultChannels(env), baseUrl: siteUrl(env), now },
      now,
      generateIdeas: ideaWiring(db, env, now, zincShare),
    },
  };
}

/**
 * A round message's deps: the wallet side for the heads-up's low-balance warning, and nothing that
 * places a gift. So the wiring itself reads no fee or margin, and Zinc being off here isn't worth a log.
 */
export async function roundWiring(now: Date, env: Env, zincShare: number): Promise<StepDeps> {
  const { db, base } = roundBase(now, env, zincShare);
  const wiring = await zincWiring(db, env);
  if (!wiring) return { ...base, zinc: null };
  const zinc: ZincDeps = { ...wiring.deps, now };
  return {
    ...base,
    zinc: {
      wallet: (userId) => getZincWallet(userId, zinc),
      lookahead: (userId, days, fee) => fundingLookahead(userId, zinc, fee, days),
      walletUrl: wiring.walletUrl,
    },
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
  // The tick sends jobs to the queue (`sendJobs`, `testClock`); a job's idea runs share Zinc's
  // rate (`zincShare`, the queue's maxConcurrency).
  opts: { sendJobs?: SendJobs; testClock?: boolean; zincShare?: number } = {},
): Promise<{ engine: EngineDeps; purchase: PurchaseDeps | null }> {
  const { db, base } = roundBase(now, env, opts.zincShare ?? 1);
  const engine: EngineDeps = {
    ...base,
    ...(opts.sendJobs ? { sendJobs: opts.sendJobs } : {}),
    ...(opts.testClock !== undefined ? { testClock: opts.testClock } : {}),
    zinc: null,
    clearUnfiledNotes: () => clearUnfiledNotes(db),
    pruneActionLinks: () => pruneExpiredActionLinks(db),
    pruneTrackingNumbers: () => pruneTrackingNumbers(db),
    // The engine's day: the tick's UTC day.
    trackingNews: () =>
      runTrackingNews({ store: engine.store, notify: engine.notify, today: now.toISOString().slice(0, 10), setting: (key) => settingInt(db, key) }),
    reactions: () => runReactions({ store: engine.store, notify: engine.notify, now }),
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
    connectKey: connectWiring(env)?.key ?? null,
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
export function webhookTellers(): {
  advanceRound: (roundId: string) => Promise<unknown>;
  orderPlaced: (roundId: string) => Promise<unknown>;
  tellDelivered: (roundId: string) => Promise<unknown>;
} {
  return {
    tellDelivered: async (roundId) => tellDelivered(roundId, (await buyingWiring(new Date())).engine),
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

// Where the health email's "What to do" links point: the runbooks in the repo's operations doc.
const RUNBOOKS = "https://github.com/gifts-af/gift-me/blob/main/design/operations.md";

/** How the health check reaches the owner: Resend and the runbook links, no database, so it works when the rest can't be built. */
export function healthAlertWiring(env: Env = process.env): Pick<HealthDeps, "send" | "runbookBase"> {
  return { send: (e) => sendEmail(e, { apiKey: env.RESEND_API_KEY, fetch }), runbookBase: RUNBOOKS };
}

/**
 * The daily health check's deps (T87): the admin client, Resend, and the two vendor balances
 * when their env vars are set here, each within the check's health_vendor_timeout_ms.
 */
export function healthWiring(now: Date, env: Env = process.env): HealthDeps {
  const db = createAdminClient();
  const gatewayBase = env.AI_GATEWAY_BASE;
  const gatewayKey = env.AI_GATEWAY_API_KEY;
  const zincBase = env.ZINC_API_BASE;
  const zincKey = env.ZINC_API_KEY;
  const aiConfigured = Boolean(gatewayBase && gatewayKey);
  const zincConfigured = Boolean(zincBase && zincKey);
  return {
    ...healthAlertWiring(env),
    db,
    now,
    aiCredits: aiConfigured
      ? async (timeoutMs) =>
          (await gatewayCredits({ base: gatewayBase!, apiKey: gatewayKey!, fetch }, AbortSignal.timeout(timeoutMs))).balanceCents
      : null,
    zincBalance: zincConfigured
      ? async (timeoutMs) => (await getWallet({ base: zincBase!, timeoutMs, fetch }, zincKey!)).balanceCents
      : null,
  };
}
