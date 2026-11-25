import { createHash } from "node:crypto";
import type { DueRound } from "./store";

// Fan-out (ALL-125): the tick sends each due round to a queue and a job runs it on its own.
// This file only decides what to send (planJobs, pure). It imports nothing from engine.ts.

/** What one queue message asks for. `now` is set only on a test clock. */
export type JobMessage =
  | { kind: "round"; roundId: string; now?: string }
  | { kind: "buyer"; userId: string; roundIds: string[]; now?: string };
export type RoundMessage = Extract<JobMessage, { kind: "round" }>;
export type BuyerMessage = Extract<JobMessage, { kind: "buyer" }>;

/**
 * A message and its idempotency key, so two identical sends the same day make one delivery. A
 * buyer key also carries a hash of its round ids, so a same-day re-run that finds a newly held
 * round sends it.
 */
export type QueuedJob = { message: JobMessage; idempotencyKey: string };

/** Sends the jobs; `failed` counts the ones the queue refused. Bound by the caller (E3). */
export type SendJobs = (jobs: QueuedJob[]) => Promise<{ sent: number; failed: number }>;

/**
 * Held (needs_attention) rounds go one message per buyer, with every one of that buyer's ids in
 * `due` order. Other rounds go one message each, and only while the engine is on.
 */
export function planJobs(due: DueRound[], engineOn: boolean, now: Date, testClock: boolean): QueuedJob[] {
  const day = now.toISOString().slice(0, 10);
  const stamp = testClock ? { now: now.toISOString() } : {};
  const buyers = new Map<string, string[]>();
  const others: QueuedJob[] = [];
  for (const r of due) {
    if (r.status === "needs_attention") {
      const ids = buyers.get(r.userId);
      if (ids) ids.push(r.id);
      else buyers.set(r.userId, [r.id]);
    } else if (engineOn) {
      others.push({ message: { kind: "round", roundId: r.id, ...stamp }, idempotencyKey: `round:${r.id}:${day}` });
    }
  }
  const held: QueuedJob[] = [...buyers].map(([userId, roundIds]) => ({
    message: { kind: "buyer", userId, roundIds, ...stamp },
    idempotencyKey: `buyer:${userId}:${day}:${roundsHash(roundIds)}`,
  }));
  return [...held, ...others];
}

/** The first 12 hex of sha256 of the sorted round ids, comma-joined: stable for the same set. */
function roundsHash(roundIds: string[]): string {
  return createHash("sha256")
    .update([...roundIds].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}
