import { z } from "zod";
import { errorFields, logEvent } from "@/lib/log";
import { verifyMessage } from "../sign";
import { isTestClock } from "../tick/tick";
import type { JobMessage, JobResult } from "@/modules/concierge";

// One queue message (ALL-125): one round, or one buyer's held gifts. The message crosses into
// the app here, so it is validated here (E4).

const id = z.string().uuid();
const now = z.string().datetime();
const sig = z.string().optional();
const messageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("round"), roundId: id, now: now.optional(), sig }),
  z.object({ kind: z.literal("buyer"), userId: id, roundIds: z.array(id).min(1), now: now.optional(), sig }),
]);

type Env = { vercelEnv?: string; cronSecret?: string };

/**
 * Runs one message. An invalid one is logged and acknowledged (a retry can't fix it), and so is one
 * whose signature (made by the tick with CRON_SECRET) doesn't verify: the queue SDK checks nothing,
 * so this is the route's own guard. A refused message is never run and never throws. The message's
 * `now` is a test clock, used only outside production (AC-13). If `run` throws, the job failed
 * before it claimed any round (the wiring, or a setting runRoundJob reads first, the fan-out
 * switch among them), so no lease is held: log an alert and rethrow, so the queue redelivers, up
 * to the trigger's maxDeliveries. A failure after a claim comes back as "failed" and is
 * acknowledged; the next tick picks the round up.
 */
export async function handleJob(
  raw: unknown,
  meta: { deliveryCount: number },
  env: Env,
  run: (message: JobMessage, now: Date) => Promise<JobResult>,
): Promise<JobResult | "invalid"> {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    logEvent("round_job", { result: "invalid", delivery_count: meta.deliveryCount });
    return "invalid";
  }
  if (!verifyMessage(parsed.data, env.cronSecret)) {
    logEvent("round_job", { result: "invalid", reason: "bad_signature", delivery_count: meta.deliveryCount, alert: true });
    return "invalid";
  }
  const message: JobMessage & { sig?: string } = { ...parsed.data };
  delete message.sig; // the engine gets the message without it
  const at = message.now && isTestClock(env.vercelEnv) ? new Date(message.now) : new Date();
  try {
    return await run(message, at);
  } catch (err) {
    const who: Record<string, string> = message.kind === "round" ? { round_id: message.roundId } : { user_id: message.userId };
    logEvent("round_job", { ...errorFields(err), kind: message.kind, result: "failed", ...who, delivery_count: meta.deliveryCount, alert: true });
    throw err;
  }
}

type Triggers = { functions: Record<string, { experimentalTriggers: { topic: string; maxConcurrency?: number }[] }> };

/** The `round-jobs` trigger's maxConcurrency in vercel.json: idea runs share Zinc's rate by it. */
export function jobMaxConcurrency(config: Triggers): number {
  const trigger = config.functions["app/api/rounds/job/route.ts"]?.experimentalTriggers.find((t) => t.topic === "round-jobs");
  const n = trigger?.maxConcurrency;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new Error("round-jobs maxConcurrency in vercel.json must be at least 1.");
  return n;
}
