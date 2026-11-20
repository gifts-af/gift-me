import { handleCallback, sendBatch, type BatchSendMessage } from "@vercel/queue";
import { errorFields, logEvent } from "@/lib/log";
import type { JobMessage, QueuedJob, SendJobs } from "@/modules/concierge";
import { signMessage } from "./sign";

// The only file that imports @vercel/queue (E3): the tick and the job route get it from here.

const TOPIC = "round-jobs";
// Vercel's sendBatch takes 1 to 100 messages a call ("Send up to 100 messages in one HTTP request").
const BATCH_MAX = 100;

type SendBatch = typeof sendBatch;
type Msg = BatchSendMessage<JobMessage & { sig: string }>;

/**
 * Each message is signed with `secret` (CRON_SECRET), which the job route checks. Sends the jobs in batches of up to 100, each with its idempotency key. "sent" and "deferred"
 * count as sent; a retryable failure is sent once more; a non-retryable one, or a batch that
 * throws, counts as failed (the tick logs it and the next day's tick picks the round up again).
 */
export function sendJobsWith(send: SendBatch, secret: string): SendJobs {
  // Returns how many were accepted and the ones to retry; a thrown call fails them all.
  async function attempt(msgs: Msg[]): Promise<{ sent: number; failed: number; retry: Msg[] }> {
    try {
      const results = await send(TOPIC, msgs);
      let sent = 0;
      let failed = 0;
      const retry: Msg[] = [];
      msgs.forEach((_m, i) => {
        const r = results[i];
        if (!r) failed++; // the queue said nothing about this one
        else if (r.status !== "failed") sent++;
        else if (r.retryable) retry.push(msgs[i]);
        else failed++;
      });
      return { sent, failed, retry };
    } catch (err) {
      logEvent("round_fanout_send_threw", { count: msgs.length, ...errorFields(err) });
      return { sent: 0, failed: msgs.length, retry: [] };
    }
  }
  return async (jobs: QueuedJob[]) => {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < jobs.length; i += BATCH_MAX) {
      const msgs: Msg[] = jobs
        .slice(i, i + BATCH_MAX)
        .map((j) => ({ payload: signMessage(j.message, secret), idempotencyKey: j.idempotencyKey }));
      const first = await attempt(msgs);
      sent += first.sent;
      failed += first.failed;
      if (first.retry.length > 0) {
        const second = await attempt(first.retry);
        sent += second.sent;
        // A retryable failure the second time is still a failure: it is not sent a third time.
        failed += second.failed + second.retry.length;
      }
    }
    return { sent, failed };
  };
}

/** The tick's sender: the real queue, messages signed with the tick's own CRON_SECRET. */
export const queueSendJobs = (secret: string): SendJobs => sendJobsWith(sendBatch, secret);
export { handleCallback };
