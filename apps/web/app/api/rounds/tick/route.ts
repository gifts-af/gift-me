import { buyingWiring } from "@/app/settings/zinc-deps";
import { runTick } from "@/modules/concierge";
import { handleTick } from "./tick";

// Called daily by Vercel Cron (vercel.json). Reads a request header, so it runs on every call.
// The engine gets the real buying side (ALL-32): stale orders are swept first, then held rounds
// are placed and their emails sent. With Zinc off here it still runs, placing nothing.
export async function GET(request: Request) {
  const vercelEnv = process.env.VERCEL_ENV;
  return handleTick(request, { cronSecret: process.env.CRON_SECRET, vercelEnv }, async (now) =>
    runTick((await buyingWiring(now)).engine),
  );
}
