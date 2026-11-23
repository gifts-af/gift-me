import { buyingWiring } from "@/lib/wiring";
import { appSettingInt } from "@/lib/app-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTick, tickHeartbeat } from "@/modules/concierge";
import { removeDeletedPhotos } from "@/modules/lists";
import { queueSendJobs } from "../queue";
import { handleTick, isTestClock } from "./tick";

// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

// Called daily by Vercel Cron (vercel.json). Reads a request header, so it runs on every call.
// The engine gets the real buying side (ALL-32): stale orders are swept first, then held rounds
// are placed and their emails sent. With Zinc off here it still runs, placing nothing.
export async function GET(request: Request) {
  const vercelEnv = process.env.VERCEL_ENV;
  const cronSecret = process.env.CRON_SECRET;
  return handleTick(
    request,
    { cronSecret, vercelEnv },
    async (now) => {
      // handleTick refuses the call when the secret is unset; it also signs the queue messages.
      if (!cronSecret) throw new Error("CRON_SECRET is unset");
      const sendJobs = queueSendJobs(cronSecret);
      return runTick((await buyingWiring(now, process.env, {}, { sendJobs, testClock: isTestClock(vercelEnv) })).engine);
    },
    // Photos of removed gifts (ALL-78), after the rounds so a storage problem can't touch them.
    () => {
      const admin = createAdminClient();
      return removeDeletedPhotos(admin, (key) => appSettingInt(key, admin));
    },
    tickHeartbeat(createAdminClient()),
  );
}
