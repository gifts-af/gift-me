import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { config } from "./config";
import { chromeStorage } from "./storage";

let client: SupabaseClient<Database> | undefined;

// One client per context (popup, service worker); they share the session via chrome.storage.local.
export function getSupabase(): SupabaseClient<Database> {
  client ??= createClient<Database>(config.supabaseUrl, config.supabaseKey, {
    auth: {
      storage: chromeStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
