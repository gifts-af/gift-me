import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorFields, logEvent } from "@/lib/log";
import type { OutgoingEmail, SendResult } from "@/lib/resend";
import { readCostPerGift } from "./costs";
import { buildHealthEmail } from "./email";
import { checkFailedReport, healthReport, type HealthReport, type HealthSettings, type HealthStage } from "./report";
import { readSnapshot } from "./store";

// The owner's daily health check (T87): the database ping that keeps the free Supabase project
// awake (T22), then the snapshot and vendor balances, then one email when something needs the
// owner or on the weekly day. Every client comes in through deps (E3).

type Db = SupabaseClient<Database>;

export type HealthDeps = {
  db: Db;
  now: Date;
  send: (e: OutgoingEmail) => Promise<SendResult>;
  /** The AI Gateway credit left, in cents, within timeoutMs; null when the Gateway isn't set up here. */
  aiCredits: ((timeoutMs: number) => Promise<number>) | null;
  /** The app's own Zinc balance, in cents, within timeoutMs; null when the app's Zinc key isn't set up here. */
  zincBalance: ((timeoutMs: number) => Promise<number>) | null;
  /** design/operations.md, where each line's runbook heading is. */
  runbookBase: string;
};

export type HealthResult = "sent" | "quiet" | "off" | "db_down" | "send_failed" | "failed";

/** The keepalive query. Returns what went wrong, or null; a paused database can throw. */
async function ping(db: Db): Promise<unknown> {
  try {
    const { error } = await db.schema("concierge").from("tick_heartbeats").select("day").limit(1);
    return error;
  } catch (e) {
    return e ?? new Error("ping failed");
  }
}

async function setting(db: Db, key: string): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) throw new Error(`Reading setting ${key} failed: ${error.message}`);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

/** The report's settings, and how long each vendor call and the costs read may take (both must fit the route's 60 s). */
async function settings(db: Db): Promise<{ report: HealthSettings; vendorTimeoutMs: number }> {
  const [allClearWeekday, aiCreditLowCents, zincAppBalanceLowCents, ideas, capture, pasteLookup, vendorTimeoutMs] = await Promise.all(
    [
      "health_all_clear_weekday",
      "ai_credit_low_cents",
      "zinc_app_balance_low_cents",
      "idea_engine_enabled",
      "capture_extraction_enabled",
      "amazon_paste_lookup_enabled",
      "health_vendor_timeout_ms",
    ].map((k) => setting(db, k)),
  );
  return {
    report: {
      allClearWeekday,
      aiCreditLowCents,
      zincAppBalanceLowCents,
      ideaEngineEnabled: ideas === 1,
      captureExtractionEnabled: capture === 1,
      amazonPasteLookupEnabled: pasteLookup === 1,
    },
    vendorTimeoutMs,
  };
}

type Balance = { cents: number | null; failed: boolean };

/**
 * A vendor balance; null cents when it isn't checked here or the call failed (logged, never thrown).
 * Tried twice: one dropped call isn't a problem, two in a row are. Both tries, then the costs, fit the route's 60 s.
 */
async function balance(vendor: string, read: ((timeoutMs: number) => Promise<number>) | null, timeoutMs: number): Promise<Balance> {
  if (!read) return { cents: null, failed: false };
  try {
    return { cents: await read(timeoutMs).catch(() => read(timeoutMs)), failed: false };
  } catch (e) {
    logEvent("health.vendor_check_failed", { vendor, ...errorFields(e) });
    return { cents: null, failed: true };
  }
}

/** The weekly costs. Never throws: costs that can't be read are one line in the email, not a problem. */
async function costs(db: Db, now: Date, timeoutMs: number): Promise<HealthReport["costs"]> {
  try {
    return await readCostPerGift(db, now, timeoutMs);
  } catch (e) {
    logEvent("health.costs_failed", errorFields(e));
    return "unreadable";
  }
}

type Sender = Pick<HealthDeps, "send" | "runbookBase">;

/** Sends the report's email; a refused send is an alert, since the owner hears nothing else. */
async function send(deps: Sender, report: HealthReport): Promise<boolean> {
  let ok: boolean;
  try {
    ok = (await deps.send(buildHealthEmail(report, deps.runbookBase))).ok;
  } catch {
    ok = false;
  }
  // The refusal's own text isn't logged: it can echo the address.
  if (!ok) logEvent("health.send_failed", { alert: true });
  return ok;
}

/**
 * The fixed "couldn't run" email: the stage it stopped at, never the error's text (E6), so a dead
 * checker isn't silent. Needs no database, so the route can send it when the wiring itself fails.
 */
export function sendCheckFailed(deps: Sender, stage: HealthStage): Promise<boolean> {
  return send(deps, checkFailedReport(stage));
}

export async function runHealthCheck(deps: HealthDeps): Promise<{ result: HealthResult; problems: number }> {
  const { db, now } = deps;
  const done = (
    result: HealthResult,
    problems: number,
    sent: boolean,
    weekly: boolean,
    extra: Record<string, string | number | boolean | null> = {},
  ) => {
    logEvent("health.checked", { result, problems, sent, weekly, ...extra });
    return { result, problems };
  };

  // Retried once: a single dropped connection isn't an outage. Down, nothing else is read.
  const down = (await ping(db)) && (await ping(db));
  if (down) {
    const sent = await send(deps, healthReport(null, null, null, now));
    return done("db_down", 1, sent, false, errorFields(down));
  }

  // Which step a failure stopped at, for the fixed email and the event.
  let stage: HealthStage = "settings";
  const at = <T>(where: HealthStage, p: Promise<T>) =>
    p.catch((e: unknown) => {
      stage = where;
      throw e;
    });
  try {
    if ((await setting(db, "health_email_enabled")) === 0) return done("off", 0, false, false);
    const s = await settings(db);
    const [snapshot, ai, zinc] = await Promise.all([
      at("snapshot", readSnapshot(db, now)),
      balance("ai_gateway", deps.aiCredits, s.vendorTimeoutMs),
      // balance() never rejects: a failed vendor call is a line in the email, not a failed check.
      balance("zinc", deps.zincBalance, s.vendorTimeoutMs),
    ]);
    stage = "snapshot";
    // A vendor with no function isn't set up here; a null balance alone can also mean its call failed.
    const vendors = {
      aiCreditCents: ai.cents,
      zincAppBalanceCents: zinc.cents,
      aiConfigured: deps.aiCredits !== null,
      zincConfigured: deps.zincBalance !== null,
      aiFailed: ai.failed,
      zincFailed: zinc.failed,
    };
    const report = healthReport(snapshot, vendors, s.report, now);
    const problems = report.problems.length;
    if (problems === 0 && !report.isWeekly) return done("quiet", 0, false, false);
    // Read after the report, so nothing about them can change its problems. Bounded like a vendor
    // call, so a hung read can't stop the email; the two limits together fit the route's 60 s.
    if (report.isWeekly) report.costs = await costs(db, now, s.vendorTimeoutMs);
    const sent = await send(deps, report);
    return done(sent ? "sent" : "send_failed", problems, sent, report.isWeekly);
  } catch (e) {
    // No fallback values (T23): a setting or the snapshot that can't be read fails the check, and
    // the owner hears so, since otherwise a broken checker looks like a quiet day.
    const sent = await sendCheckFailed(deps, stage);
    return done("failed", 1, sent, false, { stage, ...errorFields(e), alert: true });
  }
}
