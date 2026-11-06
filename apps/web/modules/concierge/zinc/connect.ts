// Connecting a user's own Zinc account from Settings (ALL-32, ALL-30): Zinc's
// device-code "Allow" sign-in, the phone, the balance guide, and disconnecting.
// Everything arrives through `deps` (E3). Secrets (the Zinc key, the webhook
// secret, the device code) never leave this file: not in a result, not in a
// log. Logs carry ids only (E6).
import { randomUUID } from "node:crypto";
import { lookaheadCents, suggestedMinimumCents, type LookaheadRound } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { hasPaidFeatures } from "../paid-features";
import { clearWebhook, getWallet, mintSandboxKey, pollDevice, setWebhook, startDevice } from "./account";
import { ZincError } from "./client";
import type { ZincHttp } from "./client";
import type { PlaceHeld, ZincDeps } from "./types";

/** The name Zinc shows next to the code the user is asked to Allow. */
const APP_NAME = "GiftsAF";

export type PaymentStatus =
  | { kind: "not_allowed" }
  | { kind: "not_connected"; feeCents: number; notice?: string }
  | { kind: "waiting"; userCode: string; verificationUrl: string; expiresAt: string; intervalSec: number }
  | {
      kind: "connected";
      balanceCents: number | null;
      autoTopUp: boolean | null;
      lookahead: { cents: number; atLeast: boolean };
      lookaheadDays: number;
      feeCents: number;
      topUpFeeBps: number;
      topUpFeeFixedCents: number;
      suggestedMinimumCents: number | null;
      topUpSuggestCents: number;
      phone: string | null;
      placingCount: number;
      onTheWayCount: number;
    };
/** A plain line instead of a status: after disconnecting where the user can't connect again. */
export type PaymentResult = PaymentStatus | { kind: "message"; text: string } | { error: string };

const NOT_ALLOWED: PaymentStatus = { kind: "not_allowed" };
const TRY_AGAIN = "We couldn't reach Zinc. Try again in a minute.";

const REVOKE_NOTICE = "Disconnected. To finish, revoke the key in your Zinc account too.";

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** Only the database: what disconnecting needs, so it works with Zinc off here. */
type DbDeps = Pick<ZincDeps, "db">;

async function setting(deps: DbDeps, key: string): Promise<number> {
  const { data, error } = await deps.db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) fail(`Reading setting ${key} failed`, error);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

type Account = { zinc_connected_at: string | null; buyer_phone: string | null; auto_topup_on: boolean | null };

async function readAccount(userId: string, deps: DbDeps): Promise<Account> {
  const { data, error } = await deps.db
    .schema("concierge")
    .from("accounts")
    .select("zinc_connected_at, buyer_phone, auto_topup_on")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Reading the account failed", error);
  return data ?? { zinc_connected_at: null, buyer_phone: null, auto_topup_on: null };
}

async function readKey(userId: string, deps: DbDeps): Promise<string | null> {
  const { data, error } = await deps.db.schema("concierge").rpc("zinc_secrets", { p_user_id: userId });
  if (error) fail("Reading the Zinc key failed", error);
  return data?.[0]?.api_key ?? null;
}

/** The balance from Zinc and the auto top-up state we know of, for ALL-29. Balance is null when Zinc can't be reached. */
export async function getZincWallet(
  userId: string,
  deps: ZincDeps,
): Promise<{ balanceCents: number | null; autoTopUp: boolean | null }> {
  const account = await readAccount(userId, deps);
  const key = await readKey(userId, deps);
  let balanceCents: number | null = null;
  if (key) {
    try {
      balanceCents = (await getWallet(deps.http, key)).balanceCents;
    } catch (error) {
      logEvent("zinc.wallet_unavailable", { user_id: userId, kind: error instanceof ZincError ? error.kind : "unknown" });
    }
  }
  return { balanceCents, autoTopUp: account.auto_topup_on };
}

async function countOrders(userId: string, deps: ZincDeps, statuses: string[]): Promise<number> {
  const { count, error } = await deps.db
    .schema("concierge")
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", statuses);
  if (error) fail("Counting orders failed", error);
  return count ?? 0;
}

async function largestBudgetCents(userId: string, deps: ZincDeps): Promise<number | null> {
  const concierge = deps.db.schema("concierge");
  const [budgets, defaults] = await Promise.all([
    concierge.from("budgets").select("amount_cents").eq("user_id", userId).order("amount_cents", { ascending: false }).limit(1),
    concierge.from("budget_defaults").select("base_amount_cents").eq("user_id", userId).order("base_amount_cents", { ascending: false }).limit(1),
  ]);
  if (budgets.error) fail("Reading budgets failed", budgets.error);
  if (defaults.error) fail("Reading default budgets failed", defaults.error);
  const all = [budgets.data?.[0]?.amount_cents, defaults.data?.[0]?.base_amount_cents].filter((n): n is number => typeof n === "number");
  return all.length ? Math.max(...all) : null;
}

/** What the user's open rounds due within `days` need from the wallet (lookaheadCents). */
export async function fundingLookahead(
  userId: string,
  deps: ZincDeps,
  feeCents: number,
  days: number,
): Promise<{ cents: number; atLeast: boolean }> {
  const until = new Date(deps.now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await deps.db.schema("concierge").rpc("lookahead_rounds", { p_user_id: userId, p_until: until });
  if (error) fail("Reading upcoming rounds failed", error);
  const rounds: LookaheadRound[] = (data ?? []).map((r) => {
    const orders = Array.isArray(r.orders)
      ? (r.orders as { max_price_cents: number; fee_cents: number }[]).map((o) => ({
          maxPriceCents: o.max_price_cents,
          feeCents: o.fee_cents,
        }))
      : null;
    return { orders, budgetCents: r.budget_cents ?? null };
  });
  return lookaheadCents(rounds, feeCents);
}

/** What Settings shows. Reading it never calls Zinc except for the balance, and never places an order. */
export async function getPaymentStatus(userId: string, deps: ZincDeps): Promise<PaymentStatus> {
  if (!(await hasPaidFeatures(deps.db, userId))) return NOT_ALLOWED;
  const feeCents = await setting(deps, "zinc_order_fee_cents");
  const account = await readAccount(userId, deps);

  if (account.zinc_connected_at) {
    const [wallet, lookaheadDays, topUpFeeBps, topUpFeeFixedCents, topUp, largest, placingCount, onTheWayCount] = await Promise.all([
      getZincWallet(userId, deps),
      setting(deps, "funding_lookahead_days"),
      setting(deps, "zinc_topup_fee_bps"),
      setting(deps, "zinc_topup_fee_fixed_cents"),
      setting(deps, "funding_topup_suggest_cents"),
      largestBudgetCents(userId, deps),
      countOrders(userId, deps, ["placing", "unconfirmed"]),
      countOrders(userId, deps, ["placed", "shipped"]),
    ]);
    return {
      kind: "connected",
      balanceCents: wallet.balanceCents,
      autoTopUp: wallet.autoTopUp,
      lookahead: await fundingLookahead(userId, deps, feeCents, lookaheadDays),
      lookaheadDays,
      feeCents,
      topUpFeeBps,
      topUpFeeFixedCents,
      suggestedMinimumCents: suggestedMinimumCents(largest, feeCents),
      topUpSuggestCents: topUp,
      phone: account.buyer_phone,
      placingCount,
      onTheWayCount,
    };
  }

  const { data: attempt, error } = await deps.db
    .schema("concierge")
    .from("zinc_connect_attempts")
    .select("user_code, verification_url, expires_at, interval_sec")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Reading the connection attempt failed", error);
  if (attempt && new Date(attempt.expires_at) > deps.now) {
    return {
      kind: "waiting",
      userCode: attempt.user_code,
      verificationUrl: attempt.verification_url,
      expiresAt: new Date(attempt.expires_at).toISOString(),
      intervalSec: attempt.interval_sec,
    };
  }
  return { kind: "not_connected", feeCents };
}

async function notConnected(userId: string, deps: ZincDeps, notice?: string): Promise<PaymentStatus> {
  const status = await getPaymentStatus(userId, deps);
  return status.kind === "not_connected" && notice ? { ...status, notice } : status;
}

async function dropAttempt(userId: string, deps: ZincDeps): Promise<void> {
  const { error } = await deps.db.schema("concierge").rpc("zinc_drop_attempt", { p_user_id: userId });
  if (error) fail("Dropping the connection attempt failed", error);
}

/** Setup is finished when connected and a phone is saved: orders that were waiting can go. */
async function maybePlaceHeld(userId: string, phone: string | null, placeHeld: PlaceHeld): Promise<void> {
  if (!phone) return;
  try {
    await placeHeld(userId);
  } catch (error) {
    // The daily tick retries held orders, so this is not the user's problem.
    logEvent("zinc.place_held_failed", { user_id: userId, ...errorFields(error) });
  }
}

/** Stores a fresh key and registers our webhook. The key is saved only once the webhook is set. */
async function finishConnect(userId: string, apiKey: string, deps: ZincDeps, placeHeld: PlaceHeld): Promise<PaymentResult> {
  const webhookId = randomUUID();
  const { secret } = await setWebhook(deps.http, apiKey, `${deps.webhookBaseUrl}/api/zinc/webhook/${webhookId}`);
  const stored = await deps.db.schema("concierge").rpc("zinc_store_secrets", {
    p_user_id: userId,
    p_api_key: apiKey,
    p_webhook_secret: secret,
    p_webhook_id: webhookId,
    p_zinc_env: deps.env,
  });
  if (stored.error) fail("Saving the Zinc connection failed", stored.error);
  await dropAttempt(userId, deps);
  logEvent("zinc.connected", { user_id: userId, zinc_env: deps.env });
  const account = await readAccount(userId, deps);
  await maybePlaceHeld(userId, account.buyer_phone, placeHeld);
  return getPaymentStatus(userId, deps);
}

function zincProblem(userId: string, event: string, error: unknown): { error: string } {
  logEvent(event, { user_id: userId, kind: error instanceof ZincError ? error.kind : "unknown", status: error instanceof ZincError ? error.status : 0 });
  return { error: TRY_AGAIN };
}

export async function startConnect(userId: string, deps: ZincDeps, placeHeld: PlaceHeld): Promise<PaymentResult> {
  if (!(await hasPaidFeatures(deps.db, userId))) return NOT_ALLOWED;
  // Already connected, or a code is still good (a second tap or tab): show that, don't issue another.
  const current = await getPaymentStatus(userId, deps);
  if (current.kind === "connected" || current.kind === "waiting") return current;

  try {
    if (deps.env === "test") {
      // Zinc's sandbox hands out a key directly: no Allow step (decided in the plan).
      const { apiKey } = await mintSandboxKey(deps.http);
      return await finishConnect(userId, apiKey, deps, placeHeld);
    }
    const device = await startDevice(deps.http, APP_NAME, deps.now);
    const { error } = await deps.db.schema("concierge").from("zinc_connect_attempts").upsert({
      user_id: userId,
      device_code: device.deviceCode,
      user_code: device.userCode,
      verification_url: device.verificationUrl,
      interval_sec: device.intervalSec,
      expires_at: device.expiresAt.toISOString(),
      polling_until: null,
      created_at: deps.now.toISOString(),
    });
    if (error) fail("Saving the connection attempt failed", error);
  } catch (error) {
    return zincProblem(userId, "zinc.connect_start_failed", error);
  }
  return getPaymentStatus(userId, deps);
}

export async function pollConnect(userId: string, deps: ZincDeps, placeHeld: PlaceHeld): Promise<PaymentResult> {
  if (!(await hasPaidFeatures(deps.db, userId))) return NOT_ALLOWED;

  // Only one tab calls Zinc at a time; the others just see where things stand (AC-3).
  const claim = await deps.db.schema("concierge").rpc("zinc_claim_poll", { p_user_id: userId, p_now: deps.now.toISOString() });
  if (claim.error) fail("Claiming the Zinc poll failed", claim.error);
  const attempt = claim.data;
  if (!attempt || !attempt.device_code) return getPaymentStatus(userId, deps);

  if (new Date(attempt.expires_at) <= deps.now) {
    await dropAttempt(userId, deps);
    return notConnected(userId, deps, "That code expired. Connect again to get a new one.");
  }

  let result;
  try {
    result = await pollDevice(deps.http, attempt.device_code);
  } catch (error) {
    // Zinc hiccuped: stay on the waiting screen and try again at the next interval.
    logEvent("zinc.poll_failed", { user_id: userId, kind: error instanceof ZincError ? error.kind : "unknown" });
    return getPaymentStatus(userId, deps);
  }

  switch (result.status) {
    case "approved":
      try {
        return await finishConnect(userId, result.apiKey, deps, placeHeld);
      } catch (error) {
        // The device code is spent, so the user has to start again.
        await dropAttempt(userId, deps);
        logEvent("zinc.connect_finish_failed", { user_id: userId, kind: error instanceof ZincError ? error.kind : "unknown" });
        return notConnected(userId, deps, "Zinc said yes, but we couldn't finish setting up. Connect again.");
      }
    case "denied":
      await dropAttempt(userId, deps);
      return notConnected(userId, deps, "Zinc wasn't allowed to connect. Connect again if that was a mistake.");
    case "expired":
      await dropAttempt(userId, deps);
      return notConnected(userId, deps, "That code expired. Connect again to get a new one.");
    case "pending":
    case "slow_down": {
      // Hold the next poll for one Zinc interval, counted from now that Zinc has answered ("slow down"
      // adds 5 s, RFC 8628). Only this attempt's device code is touched.
      const intervalSec = attempt.interval_sec + (result.status === "slow_down" ? 5 : 0);
      const { error } = await deps.db
        .schema("concierge")
        .rpc("zinc_release_poll", { p_user_id: userId, p_device_code: attempt.device_code, p_interval_sec: intervalSec });
      if (error) fail("Saving the poll interval failed", error);
      return getPaymentStatus(userId, deps);
    }
  }
}

export async function cancelConnect(userId: string, deps: ZincDeps): Promise<PaymentResult> {
  if (!(await hasPaidFeatures(deps.db, userId))) return NOT_ALLOWED;
  await dropAttempt(userId, deps);
  return getPaymentStatus(userId, deps);
}

/** `http` is null where Zinc isn't switched on in this environment. */
export type DisconnectDeps = DbDeps & { http: ZincHttp | null };

/**
 * Removes the user's Zinc key (AC-5). Always allowed to a signed-in user (owner, S7): no paid
 * features and no Zinc environment needed, so anyone can take their key back. Refused only
 * while an order is placing or unconfirmed (zinc_forget). Without Zinc here, the key and our
 * columns still go and clearing the webhook at Zinc is skipped (logged): revoking the key in
 * Zinc stops it anyway, which the notice asks the user to do.
 */
export async function disconnect(userId: string, deps: DisconnectDeps): Promise<PaymentResult> {
  // The key is read before it is forgotten: it is needed to clear our webhook at Zinc.
  const key = await readKey(userId, deps);
  const account = await readAccount(userId, deps);
  if (key || account.zinc_connected_at) {
    const forgot = await deps.db.schema("concierge").rpc("zinc_forget", { p_user_id: userId });
    if (forgot.error) fail("Disconnecting failed", forgot.error);
    if (forgot.data === "placing") {
      return { error: "A gift is being ordered right now. Try again in a few hours, once it has gone through." };
    }
    if (key && deps.http) {
      try {
        await clearWebhook(deps.http, key);
      } catch (error) {
        logEvent("zinc.webhook_clear_failed", { user_id: userId, kind: error instanceof ZincError ? error.kind : "unknown" });
      }
    } else if (key) {
      logEvent("zinc.webhook_clear_skipped", { user_id: userId, reason: "zinc_off" });
    }
    logEvent("zinc.disconnected", { user_id: userId });
  }
  // What Settings shows next: connect again where the user can, otherwise a plain line.
  if (deps.http && (await hasPaidFeatures(deps.db, userId))) {
    return { kind: "not_connected", feeCents: await setting(deps, "zinc_order_fee_cents"), notice: REVOKE_NOTICE };
  }
  return { kind: "message", text: REVOKE_NOTICE };
}

/** Whether the user still has a Zinc key or account link saved (for Settings' disconnect-only view). */
export async function hasZincConnection(userId: string, db: ZincDeps["db"]): Promise<boolean> {
  const account = await readAccount(userId, { db });
  return account.zinc_connected_at !== null || (await readKey(userId, { db })) !== null;
}

/** Digits only, a leading US country code dropped. Null when it isn't 10 digits. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export async function savePhone(userId: string, raw: string, deps: ZincDeps, placeHeld: PlaceHeld): Promise<PaymentResult> {
  if (!(await hasPaidFeatures(deps.db, userId))) return NOT_ALLOWED;
  const phone = normalizePhone(raw);
  if (!phone) return { error: "Enter a 10-digit phone number." };
  const account = await readAccount(userId, deps);
  if (!account.zinc_connected_at) return { error: "Connect Zinc first." };

  const { error } = await deps.db.schema("concierge").from("accounts").update({ buyer_phone: phone }).eq("user_id", userId);
  if (error) fail("Saving the phone failed", error);
  await maybePlaceHeld(userId, phone, placeHeld);
  return getPaymentStatus(userId, deps);
}
