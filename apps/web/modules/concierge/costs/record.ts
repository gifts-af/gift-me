// Records what a costed call cost. Never throws and never holds up the caller:
// a cost is bookkeeping, and the user's action must succeed without it. Money caps
// work from their own counters, not from these rows.
import "server-only";
import { logEvent } from "@/lib/log";
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
 * The write is aborted at cost_record_timeout_ms, read here unless `timeoutMs` is passed. That
 * read is bounded only by the route's own limit. The client is made inside the try, so a missing
 * key fails the record, not the caller. A failure logs cost.record_failed with the kind and ids
 * (E6), never the error's message.
 */
export function costRecorder(makeDb: () => AdminDb, timeoutMs?: number): RecordCost {
  return async (cost) => {
    try {
      const db = makeDb();
      const ms = timeoutMs ?? (await readTimeoutMs(db));
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
      if (error) throw new Error("record_cost failed");
    } catch {
      fail(cost);
    }
  };
}

async function readTimeoutMs(db: AdminDb): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "cost_record_timeout_ms" });
  if (error || typeof data !== "number" || data <= 0) throw new Error("cost_record_timeout_ms unreadable");
  return data;
}

function fail(cost: Cost): void {
  try {
    logEvent("cost.record_failed", {
      kind: cost.kind,
      user_id: cost.userId,
      ...(cost.ideaRunId ? { idea_run_id: cost.ideaRunId } : {}),
      ...(cost.orderId ? { order_id: cost.orderId } : {}),
    });
  } catch {
    // Logging must not break the caller either.
  }
}
