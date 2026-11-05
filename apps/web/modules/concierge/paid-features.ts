import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";

/**
 * Whether this user may run things that spend money (ALL-94, decision 53). A
 * failed check throws, so money is never spent on a guess.
 */
export async function hasPaidFeatures(db: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await db.schema("concierge").rpc("has_paid_features", { p_user_id: userId });
  if (error) throw new Error(`Checking paid features failed: ${error.message}`);
  return data === true;
}
