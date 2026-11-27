import { errorFields, logEvent } from "@/lib/log";
import { dayOf, type TickHeartbeat, type TickSummary } from "@/modules/concierge";

// The daily round tick (ALL-28). Vercel Cron calls it with
// `Authorization: Bearer $CRON_SECRET`. Outside production, ?now= sets the
// clock so tests can walk through a round's days (AC-13). The heartbeat row is written only
// after the secret check, on the tick's own clock, so ?now= moves it as it moves the tick.

type Env = { cronSecret?: string; vercelEnv?: string };

/** Jobs carry the tick's `now` only off production, where ?now= can set it (AC-13). */
export const isTestClock = (vercelEnv?: string): boolean => vercelEnv !== "production";

export async function handleTick(
  request: Request,
  env: Env,
  run: (now: Date) => Promise<TickSummary>,
  cleanup?: () => Promise<unknown>,
  heartbeat?: TickHeartbeat,
): Promise<Response> {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let now = new Date();
  if (isTestClock(env.vercelEnv)) {
    const raw = new URL(request.url).searchParams.get("now");
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) now = parsed;
  }
  const day = dayOf(now);
  const startedMs = Date.now();
  // The finish is the tick's clock plus the time the run took.
  const finishedAt = () => new Date(now.getTime() + (Date.now() - startedMs));
  await beat(() => heartbeat?.started(day, now));
  let summary: TickSummary;
  try {
    summary = await run(now);
  } catch {
    logEvent("round_tick_failed", {});
    await beat(() => heartbeat?.finished(day, finishedAt(), "failed", { roundsFailed: 0, fanoutFailed: 0 }));
    return Response.json({ ok: false }, { status: 500 });
  }
  const fanoutFailed = summary.fanoutFailed ?? 0;
  await beat(() => heartbeat?.finished(day, finishedAt(), "ok", { roundsFailed: summary.failed - fanoutFailed, fanoutFailed }));
  // Housekeeping after the rounds: its own failure never changes the tick's result.
  try {
    await cleanup?.();
  } catch (err) {
    logEvent("tick_cleanup_failed", errorFields(err));
  }
  return Response.json({ ok: true, ...summary });
}

/** The `only` query parameter, or null when there's none. */
export const onlyStep = (request: Request): string | null => new URL(request.url).searchParams.get("only");

export type HousekeepingSteps = Record<string, () => Promise<unknown>>;

/**
 * Runs the housekeeping steps in order. One step's failure is logged with its name and never
 * stops the next.
 */
export async function runHousekeeping(steps: HousekeepingSteps): Promise<void> {
  for (const [step, run] of Object.entries(steps)) {
    try {
      await run();
    } catch (err) {
      logEvent("tick_cleanup_failed", { step, ...errorFields(err) });
    }
  }
}

/**
 * `?only=<step>`: one housekeeping step on its own, behind the same secret, so it can be forced on
 * production without running the day's rounds again (a forced tick runs everyone's due rounds).
 * An unknown step is refused and nothing runs.
 */
export async function handleTickStep(request: Request, env: Env, steps: HousekeepingSteps): Promise<Response> {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const step = onlyStep(request);
  const run = step !== null && Object.hasOwn(steps, step) ? steps[step] : null;
  if (!run) return Response.json({ ok: false, error: "unknown step" }, { status: 400 });
  try {
    const result = await run();
    return Response.json({ ok: true, result });
  } catch (err) {
    logEvent("tick_cleanup_failed", { step, ...errorFields(err) });
    return Response.json({ ok: false }, { status: 500 });
  }
}

/** A heartbeat write that fails is an alert, but never changes the tick's own result. */
async function beat(write: () => Promise<void> | undefined): Promise<void> {
  try {
    await write();
  } catch (err) {
    logEvent("tick.heartbeat_failed", { ...errorFields(err), alert: true });
  }
}
