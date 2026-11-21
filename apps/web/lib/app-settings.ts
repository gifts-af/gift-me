import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { createClient } from "@/lib/supabase/server";

/**
 * A whole-number app-wide setting from concierge.app_settings (T23), for
 * shared app code. Throws if it's missing: there's no fallback in code.
 * Reads as the cookie-signed-in user unless given a client: a route called
 * with a bearer token (the extension's) passes its own, since setting_int is
 * for signed-in users only.
 */
export async function appSettingInt(key: string, db?: SupabaseClient<Database>): Promise<number> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) throw new Error(`Reading setting ${key} failed: ${error.message}`);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}
