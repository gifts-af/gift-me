import { buyingWiring } from "@/app/settings/zinc-deps";
import { runTick } from "@/modules/concierge";
import { handleTick } from "./tick";

// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

// Called daily by Vercel Cron (vercel.json). Reads a request header, so it runs on every call.
// The engine gets the real buying side (ALL-32): stale orders are swept first, then held rounds
// are placed and their emails sent. With Zinc off here it still runs, placing nothing.
export async function GET(request: Request) {
  const vercelEnv = process.env.VERCEL_ENV;
  return handleTick(request, { cronSecret: process.env.CRON_SECRET, vercelEnv }, async (now) =>
    runTick((await buyingWiring(now)).engine),
  );
}
