import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import type { PlaceHeld, ZincDeps } from "@/modules/concierge";

// Where ZINC_ENV and ZINC_API_BASE are read (E3): the module logic only sees `deps`.
// Anything but "test" or "live" means Zinc is off in this environment.
export async function zincDeps(db: SupabaseClient<Database>, webhookBaseUrl: string): Promise<ZincDeps | null> {
  const env = process.env.ZINC_ENV;
  const base = process.env.ZINC_API_BASE;
  if ((env !== "test" && env !== "live") || !base) return null;
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "zinc_timeout_ms" });
  if (error || typeof data !== "number") throw new Error("Reading setting zinc_timeout_ms failed.");
  return { db, http: { base, timeoutMs: data, fetch }, env, webhookBaseUrl, now: new Date() };
}

// ALL-32 Task 7 swaps in the real placeHeldForUser. Until then, held orders are picked up by the daily tick.
export const placeHeld: PlaceHeld = async () => {};
