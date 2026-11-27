import { buyingWiring } from "@/lib/wiring";
import { appSettingInt } from "@/lib/app-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTick, tickHeartbeat, type TickHeartbeat } from "@/modules/concierge";
import { removeDeletedPhotos, runPhotoRepair } from "@/modules/lists";
import { queueSendJobs } from "../queue";
import { handleTick, handleTickStep, isTestClock, onlyStep } from "./tick";

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
  const zincBase = process.env.ZINC_API_BASE;
  const zincKey = process.env.ZINC_API_KEY;
  const zinc = zincBase && zincKey ? { base: zincBase, key: zincKey } : null;
  // Gifts with a link but no usable photo, tried again (photo_repair_enabled switches it off).
  const photoRepair = () => runPhotoRepair(createAdminClient(), zinc);

  // ?only=photo_repair forces just that step, without the day's rounds.
  if (onlyStep(request) === "photo_repair") return handleTickStep(request, { cronSecret }, photoRepair);

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
    // Then the photo repair; each step's failure is logged on its own and never stops the other.
    async () => {
      const admin = createAdminClient();
      let failed = 0;
      for (const step of [() => removeDeletedPhotos(admin, (key) => appSettingInt(key, admin)), photoRepair]) {
        try {
          await step();
        } catch {
          failed++;
        }
      }
      if (failed > 0) throw new Error(`${failed} housekeeping steps failed`);
    },
    lazyHeartbeat(),
  );
}

// Built on first use, after handleTick's secret check, so a call without the secret never needs
// the admin client (and can't fail before the 401 when its env is missing).
function lazyHeartbeat(): TickHeartbeat {
  let made: TickHeartbeat | null = null;
  const get = () => (made ??= tickHeartbeat(createAdminClient()));
  return {
    started: (day, at) => get().started(day, at),
    finished: (day, at, result, counts) => get().finished(day, at, result, counts),
  };
}
