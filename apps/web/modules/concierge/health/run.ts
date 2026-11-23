import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorFields, logEvent } from "@/lib/log";
import type { OutgoingEmail, SendResult } from "@/lib/resend";
import { buildHealthEmail } from "./email";
import { healthReport, type HealthReport, type HealthSettings } from "./report";
import { readSnapshot } from "./store";

// The owner's daily health check (T87): the database ping that keeps the free Supabase project
// awake (T22), then the snapshot and vendor balances, then one email when something needs the
// owner or on the weekly day. Every client comes in through deps (E3).

type Db = SupabaseClient<Database>;

export type HealthDeps = {
  db: Db;
  now: Date;
  send: (e: OutgoingEmail) => Promise<SendResult>;
  /** The AI Gateway credit left, in cents; null when the Gateway isn't set up here. */
  aiCredits: (() => Promise<number>) | null;
  /** The app's own Zinc balance, in cents; null when the app's Zinc key isn't set up here. */
  zincBalance: (() => Promise<number>) | null;
  aiConfigured: boolean;
  zincConfigured: boolean;
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

async function settings(db: Db): Promise<HealthSettings> {
  const [allClearWeekday, aiCreditLowCents, zincAppBalanceLowCents, ideas, capture] = await Promise.all(
    ["health_all_clear_weekday", "ai_credit_low_cents", "zinc_app_balance_low_cents", "idea_engine_enabled", "capture_extraction_enabled"].map(
      (k) => setting(db, k),
    ),
  );
  return { allClearWeekday, aiCreditLowCents, zincAppBalanceLowCents, ideaEngineEnabled: ideas === 1, captureExtractionEnabled: capture === 1 };
}

/** A vendor balance, or null when it isn't checked here or the call failed (logged, never thrown). */
async function balance(vendor: string, read: (() => Promise<number>) | null): Promise<number | null> {
  if (!read) return null;
  try {
    return await read();
  } catch (e) {
    logEvent("health.vendor_check_failed", { vendor, ...errorFields(e) });
    return null;
  }
}

/** Sends the report's email; a refused send is an alert, since the owner hears nothing else. */
async function send(deps: HealthDeps, report: HealthReport): Promise<boolean> {
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

  try {
    if ((await setting(db, "health_email_enabled")) === 0) return done("off", 0, false, false);
    const [s, snapshot, aiCreditCents, zincAppBalanceCents] = await Promise.all([
      settings(db),
      readSnapshot(db, now),
      balance("ai_gateway", deps.aiCredits),
      balance("zinc", deps.zincBalance),
    ]);
    const vendors = { aiCreditCents, zincAppBalanceCents, aiConfigured: deps.aiConfigured, zincConfigured: deps.zincConfigured };
    const report = healthReport(snapshot, vendors, s, now);
    const problems = report.problems.length;
    if (problems === 0 && !report.isWeekly) return done("quiet", 0, false, false);
    const sent = await send(deps, report);
    return done(sent ? "sent" : "send_failed", problems, sent, report.isWeekly);
  } catch (e) {
    // No fallback values (T23): a setting or the snapshot that can't be read fails the check.
    return done("failed", 0, false, false, { ...errorFields(e), alert: true });
  }
}
