import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";

/**
 * Whether this person has been let into the concierge, which is by request. A
 * failed check throws, so nobody is let in, or turned away, on a guess.
 */
export async function hasConciergeAccess(db: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await db.schema("concierge").rpc("has_concierge_access", { p_user_id: userId });
  if (error) throw new Error(`Checking concierge access failed: ${error.message}`);
  return data === true;
}

/** Whether this person has access, and if not, whether they've asked. No account row means neither. */
export async function getAccessState(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<{ access: boolean; requested: boolean }> {
  const { data, error } = await db
    .schema("concierge")
    .from("accounts")
    .select("concierge_access, access_requested_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Reading concierge access failed: ${error.message}`);
  return { access: data?.concierge_access ?? false, requested: data != null && data.access_requested_at !== null };
}
