import { errorFields, logEvent } from "@/lib/log";
import { isTestClock } from "../rounds/tick/tick";

// The owner's daily health check (T87), called by Vercel Cron with `Authorization: Bearer
// $CRON_SECRET`. Nothing is read before the secret check. Off production, ?now= sets the clock,
// as on the tick, so a test can run it on a chosen day.

type Env = { cronSecret?: string; vercelEnv?: string };

// A check that didn't reach the owner, or couldn't look: 500, so Vercel's cron list shows it.
const FAILED = new Set(["db_down", "send_failed", "failed"]);

export async function handleHealth(request: Request, env: Env, run: (now: Date) => Promise<unknown>): Promise<Response> {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let now = new Date();
  if (isTestClock(env.vercelEnv)) {
    const raw = new URL(request.url).searchParams.get("now");
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) now = parsed;
  }
  let out: unknown;
  try {
    out = await run(now);
  } catch (e) {
    // The wiring itself failed (an env var missing), before the check could log anything.
    logEvent("health.checked", { result: "failed", problems: 0, sent: false, weekly: false, ...errorFields(e), alert: true });
    return Response.json({ ok: false }, { status: 500 });
  }
  const result = (out as { result?: unknown } | null)?.result;
  const ok = !FAILED.has(String(result));
  return Response.json({ ok, ...(out as object) }, { status: ok ? 200 : 500 });
}
