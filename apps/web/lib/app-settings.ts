import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * A whole-number app-wide setting from concierge.app_settings (T23), for
 * shared app code. Throws if it's missing: there's no fallback in code.
 */
export async function appSettingInt(key: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) throw new Error(`Reading setting ${key} failed: ${error.message}`);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}
