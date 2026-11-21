import { logEvent } from "@/lib/log";
import type { TickSummary } from "@/modules/concierge";

// The daily round tick (ALL-28). Vercel Cron calls it with
// `Authorization: Bearer $CRON_SECRET`. Outside production, ?now= sets the
// clock so tests can walk through a round's days (AC-13).

type Env = { cronSecret?: string; vercelEnv?: string };

/** Jobs carry the tick's `now` only off production, where ?now= can set it (AC-13). */
export const isTestClock = (vercelEnv?: string): boolean => vercelEnv !== "production";

export async function handleTick(
  request: Request,
  env: Env,
  run: (now: Date) => Promise<TickSummary>,
  cleanup?: () => Promise<unknown>,
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
  let summary: TickSummary;
  try {
    summary = await run(now);
  } catch {
    logEvent("round_tick_failed", {});
    return Response.json({ ok: false }, { status: 500 });
  }
  // Housekeeping after the rounds: its own failure never changes the tick's result.
  try {
    await cleanup?.();
  } catch {
    logEvent("tick_cleanup_failed", {});
  }
  return Response.json({ ok: true, ...summary });
}
