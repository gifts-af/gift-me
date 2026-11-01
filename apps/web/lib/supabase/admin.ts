import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Service-role client: bypasses Row Level Security. Server-only; never import
 * it from client code. Create one per use, like the cookie-based client.
 */
export function createAdminClient() {
  if (!supabaseSecretKey) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient<Database>(supabaseUrl!, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
