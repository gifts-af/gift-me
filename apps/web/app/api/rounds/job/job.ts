import { z } from "zod";
import { logEvent } from "@/lib/log";
import type { JobMessage, JobResult } from "@/modules/concierge";

// One queue message (ALL-125): one round, or one buyer's held gifts. The message crosses into
// the app here, so it is validated here (E4).

const id = z.string().uuid();
const now = z.string().datetime();
const messageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("round"), roundId: id, now: now.optional() }),
  z.object({ kind: z.literal("buyer"), userId: id, roundIds: z.array(id).min(1), now: now.optional() }),
]);

type Env = { vercelEnv?: string };

/**
 * Runs one message. An invalid one is logged and acknowledged (a retry can't fix it). The message's
 * `now` is a test clock, used only outside production (AC-13). If `run` throws, the wiring failed
 * before the engine started (runRoundJob itself never throws): log an alert and rethrow, so the
 * queue retries, up to the trigger's maxDeliveries.
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
  const message: JobMessage = parsed.data;
  const at = message.now && env.vercelEnv !== "production" ? new Date(message.now) : new Date();
  try {
    return await run(message, at);
  } catch (err) {
    const who: Record<string, string> = message.kind === "round" ? { round_id: message.roundId } : { user_id: message.userId };
    logEvent("round_job", { kind: message.kind, result: "failed", ...who, delivery_count: meta.deliveryCount, alert: true });
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
