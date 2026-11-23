import { healthAlertWiring, healthWiring } from "@/lib/wiring";
import { runHealthCheck, sendCheckFailed } from "@/modules/concierge";
import { handleHealth } from "./health";

// The ping, the snapshot, two vendor calls and one email; the vendor calls have their own
// timeouts. Next needs a literal here.
export const maxDuration = 60;

// Called daily by Vercel Cron (vercel.json), two hours after the tick so it can see whether the
// tick finished. Its first query also keeps the free Supabase project from pausing (T22).
export async function GET(request: Request) {
  return handleHealth(
    request,
    { cronSecret: process.env.CRON_SECRET, vercelEnv: process.env.VERCEL_ENV },
    (now) => runHealthCheck(healthWiring(now, process.env)),
    () => sendCheckFailed(healthAlertWiring(process.env), "wiring"),
  );
}
