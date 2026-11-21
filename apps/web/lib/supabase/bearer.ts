import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { supabaseKey, supabaseUrl } from "./env";

/**
 * A client acting as the user whose access token a request carries (the
 * Chrome extension sends `Authorization: Bearer …`), so Row Level Security
 * applies. Null when the token isn't valid or has expired.
 */
export async function createBearerClient(
  accessToken: string,
): Promise<{ db: SupabaseClient<Database>; userId: string } | null> {
  const db = createClient<Database>(supabaseUrl!, supabaseKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { db, userId: data.user.id };
}
