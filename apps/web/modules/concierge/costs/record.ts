// Records what a costed call cost. Never fails the caller: a cost is bookkeeping, and the
// user's action must succeed without it. It can delay the caller by up to the write timeout
// plus one settings read. Money caps work from their own counters, not from these rows.
import "server-only";
import { errorFields, logEvent } from "@/lib/log";
import type { AdminDb } from "../ideas/store";

export type CostKind = "ai_ideas" | "lookup_ideas" | "ai_capture" | "lookup_price_check";

export type Cost = {
  userId: string;
  kind: CostKind;
  cents: number; // fractions allowed; the caller always knows it
  estimated: boolean;
  ideaRunId?: string;
  orderId?: string;
};

export type RecordCost = (cost: Cost) => Promise<void>;

/**
 * Never fails the caller, but can add up to the write timeout (cost_record_timeout_ms, read here
 * unless `timeoutMs` is passed) plus one settings read, which is bounded only by the route's own
 * limit. A failure logs cost.record_failed with the kind, ids and a reason (E6): "client" when the
 * database client couldn't be made (a missing key), "setting" when the timeout couldn't be read,
 * "write" when the write failed or timed out. The error adds only its code and status, never its
 * message.
 */
export function costRecorder(makeDb: () => AdminDb, timeoutMs?: number): RecordCost {
  return async (cost) => {
    let reason: Reason = "client";
    try {
      const db = makeDb();
      reason = "setting";
      const ms = timeoutMs ?? (await readTimeoutMs(db));
      reason = "write";
      const { error } = await db
        .schema("concierge")
        .rpc("record_cost", {
          p_user_id: cost.userId,
          p_kind: cost.kind,
          p_cents: cost.cents,
          p_estimated: cost.estimated,
          p_idea_run_id: cost.ideaRunId,
          p_order_id: cost.orderId,
        })
        .abortSignal(AbortSignal.timeout(ms));
      if (error) throw error;
    } catch (e) {
      fail(cost, reason, e);
    }
  };
}

type Reason = "client" | "setting" | "write";

async function readTimeoutMs(db: AdminDb): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "cost_record_timeout_ms" });
  if (error) throw error;
  if (typeof data !== "number" || data <= 0) throw new Error("cost_record_timeout_ms unreadable");
  return data;
}

function fail(cost: Cost, reason: Reason, e: unknown): void {
  try {
    const { code, status } = errorFields(e);
    logEvent("cost.record_failed", {
      kind: cost.kind,
      user_id: cost.userId,
      ...(cost.ideaRunId ? { idea_run_id: cost.ideaRunId } : {}),
      ...(cost.orderId ? { order_id: cost.orderId } : {}),
      reason,
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
    });
  } catch {
    // Logging must not break the caller either.
  }
}
