import type { CalendarDate, Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";

// The daily tick's heartbeat row (T87): when it started and finished, and how many rounds and
// fan-out sends failed. The health check reads it to tell a tick that never ran or never finished.

export type TickHeartbeat = {
  started(day: CalendarDate, at: Date): Promise<void>;
  finished(day: CalendarDate, at: Date, result: "ok" | "failed", counts: { roundsFailed: number; fanoutFailed: number }): Promise<void>;
};

type Db = SupabaseClient<Database>;

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} failed: ${error.message}`);
}

export function tickHeartbeat(db: Db): TickHeartbeat {
  return {
    async started(day, at) {
      const { error } = await db.schema("concierge").rpc("start_tick", { p_day: day, p_at: at.toISOString() });
      check("Recording the tick's start", error);
    },
    async finished(day, at, result, counts) {
      const { error } = await db.schema("concierge").rpc("finish_tick", {
        p_day: day,
        p_at: at.toISOString(),
        p_result: result,
        p_rounds_failed: counts.roundsFailed,
        p_fanout_failed: counts.fanoutFailed,
      });
      check("Recording the tick's finish", error);
    },
  };
}

/** A queue job's failures, added to the day's row; with fan-out on they happen outside the tick. */
export async function addTickCounts(db: Db, day: CalendarDate, at: Date, counts: { roundsFailed: number }): Promise<void> {
  const { error } = await db
    .schema("concierge")
    .rpc("add_tick_counts", { p_day: day, p_at: at.toISOString(), p_rounds_failed: counts.roundsFailed });
  check("Adding the job's failures to the tick", error);
}
