import { logEvent } from "@/lib/log";
import type { TickSummary } from "@/modules/concierge";

// The daily round tick (ALL-28). Vercel Cron calls it with
// `Authorization: Bearer $CRON_SECRET`. Outside production, ?now= sets the
// clock so tests can walk through a round's days (AC-13).

type Env = { cronSecret?: string; vercelEnv?: string };

export async function handleTick(
  request: Request,
  env: Env,
  run: (now: Date) => Promise<TickSummary>,
): Promise<Response> {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let now = new Date();
  if (env.vercelEnv !== "production") {
    const raw = new URL(request.url).searchParams.get("now");
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) now = parsed;
  }
  try {
    return Response.json({ ok: true, ...(await run(now)) });
  } catch {
    logEvent("round_tick_failed", {});
    return Response.json({ ok: false }, { status: 500 });
  }
}
