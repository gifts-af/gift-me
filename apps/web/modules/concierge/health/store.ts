import { z } from "zod";
import type { AdminDb } from "../ideas/store";

// What `concierge.health_snapshot` returns: ids, counts, reasons and dates only
// (E6, T42). Parsed here because the database is a boundary (E4).
const roundRef = z.object({ round_id: z.string(), user_id: z.string() });
const orderRef = roundRef.extend({ order_id: z.string() });

const snapshotSchema = z
  .object({
    tick: z.object({
      last_ok_finished_at: z.string().nullable(),
      today: z
        .object({
          started_at: z.string(),
          finished_at: z.string().nullable(),
          result: z.enum(["ok", "failed"]).nullable(),
          rounds_failed: z.number(),
          fanout_failed: z.number(),
        })
        .nullable(),
    }),
    no_credit_runs: z.number(),
    stuck_rounds: z.array(roundRef.extend({ attempts: z.number() })),
    unconfirmed: z.array(orderRef),
    placing_stale: z.array(orderRef),
    held_zinc: z.array(orderRef.extend({ hold_reason: z.string() })),
    deadline_close: z.array(roundRef.extend({ reason: z.string(), ship_by_deadline: z.string() })),
    ideas_waiting: z.array(roundRef.extend({ ship_by_deadline: z.string() })),
    weekly: z.object({
      waiting_address: z.number(),
      waiting_funds: z.number(),
      waiting_setup: z.number(),
      waiting_approval: z.number(),
      no_ideas: z.number(),
      rounds_failed: z.number(),
      failed_captures: z.number(),
    }),
  })
  .transform((s) => ({
    tick: {
      lastOkFinishedAt: s.tick.last_ok_finished_at,
      today: s.tick.today && {
        startedAt: s.tick.today.started_at,
        finishedAt: s.tick.today.finished_at,
        result: s.tick.today.result,
        roundsFailed: s.tick.today.rounds_failed,
        fanoutFailed: s.tick.today.fanout_failed,
      },
    },
    noCreditRuns: s.no_credit_runs,
    stuckRounds: s.stuck_rounds.map((r) => ({ roundId: r.round_id, userId: r.user_id, attempts: r.attempts })),
    unconfirmed: s.unconfirmed.map((o) => ({ orderId: o.order_id, roundId: o.round_id, userId: o.user_id })),
    placingStale: s.placing_stale.map((o) => ({ orderId: o.order_id, roundId: o.round_id, userId: o.user_id })),
    heldZinc: s.held_zinc.map((o) => ({ orderId: o.order_id, roundId: o.round_id, userId: o.user_id, holdReason: o.hold_reason })),
    deadlineClose: s.deadline_close.map((r) => ({ roundId: r.round_id, userId: r.user_id, reason: r.reason, shipByDeadline: r.ship_by_deadline })),
    ideasWaiting: s.ideas_waiting.map((r) => ({ roundId: r.round_id, userId: r.user_id, shipByDeadline: r.ship_by_deadline })),
    weekly: {
      waitingAddress: s.weekly.waiting_address,
      waitingFunds: s.weekly.waiting_funds,
      waitingSetup: s.weekly.waiting_setup,
      waitingApproval: s.weekly.waiting_approval,
      noIdeas: s.weekly.no_ideas,
      roundsFailed: s.weekly.rounds_failed,
      failedCaptures: s.weekly.failed_captures,
    },
  }));

export type HealthSnapshot = z.output<typeof snapshotSchema>;

export async function readSnapshot(db: AdminDb, now: Date): Promise<HealthSnapshot> {
  const { data, error } = await db.schema("concierge").rpc("health_snapshot", { p_now: now.toISOString() });
  if (error) throw new Error(`Reading the health snapshot failed: ${error.message}`);
  return snapshotSchema.parse(data);
}
