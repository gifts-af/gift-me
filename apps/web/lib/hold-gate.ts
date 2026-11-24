import "server-only";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readHoldGate, type HoldGate } from "@/modules/concierge";

/** What a held gift's line checks for this user, read only when there is one (see readHoldGate). */
export function holdGateFor(
  supabase: unknown,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): () => Promise<HoldGate> {
  const zincEnv = env.ZINC_ENV === "test" || env.ZINC_ENV === "live" ? env.ZINC_ENV : null;
  return () => readHoldGate(supabase as SupabaseClient<Database>, userId, { adminDb: createAdminClient(), zincEnv });
}
