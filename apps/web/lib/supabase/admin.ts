import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { supabaseUrl } from "./env";

// Service-role key (bypasses RLS). Kept here, behind server-only, because
// env.ts is also imported by client code. Deliberately not NEXT_PUBLIC.
// Production only has the GIFT_-prefixed one from the Vercel integration.
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.GIFT_SUPABASE_SECRET_KEY;

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
