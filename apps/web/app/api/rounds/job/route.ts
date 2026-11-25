import vercelJson from "../../../../vercel.json";
import { buyingWiring, roundWiring } from "@/lib/wiring";
import { createAdminClient } from "@/lib/supabase/admin";
import { addTickCounts, dayOf, runBuyerMessage, runRoundMessage } from "@/modules/concierge";
import { handleCallback, queueSendJobs } from "../queue";
import { handleJob, jobMaxConcurrency } from "./job";

// A buyer message can place gifts at Zinc, so it gets the same 300 s as the tick. Next needs a literal here.
export const maxDuration = 300;

// Vercel's queue calls this (the trigger is in vercel.json), once per message. Idea runs share
// Zinc's rate by the trigger's maxConcurrency, read from that same file inside the call (E3).
export const POST = handleCallback(async (message, metadata) => {
  await handleJob(
    message,
    metadata,
    { vercelEnv: process.env.VERCEL_ENV, cronSecret: process.env.CRON_SECRET },
    async (m, now) => {
      const zincShare = jobMaxConcurrency(vercelJson);
      if (m.kind === "buyer") return runBuyerMessage(m, (await buyingWiring(now, process.env, {}, { zincShare })).engine);
      const cronSecret = process.env.CRON_SECRET;
      // handleJob refuses the message when the secret is unset; it also signs the follow-up.
      if (!cronSecret) throw new Error("CRON_SECRET is unset");
      return runRoundMessage(m, { ...(await roundWiring(now, process.env, zincShare)), sendJobs: queueSendJobs(cronSecret) });
    },
    // A failed job counts toward the day's heartbeat, on the job's clock like the tick's.
    (_m, now) => addTickCounts(createAdminClient(), dayOf(now), now, { roundsFailed: 1 }),
  );
});
