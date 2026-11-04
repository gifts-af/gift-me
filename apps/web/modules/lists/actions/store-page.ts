"use server";

import { lookup } from "node:dns/promises";
import { appSettingInt } from "@/lib/app-settings";
import { logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { lookupStorePage, type LookupStorePageResult } from "@/modules/lists/lib/store-page-fetch";

const MAX_URL_LENGTH = 2048;

/**
 * Reads a pasted store link's page for its name, price and photo (ALL-10,
 * planning decision 50). Reachable by direct POST like any Server Action, so
 * it checks the input and sign-in itself: only signed-in people can make our
 * server fetch a page. The work, and its safety checks, are in
 * lookupStorePage(); this only builds what it needs (E3).
 */
export async function readStorePage(url: unknown): Promise<LookupStorePageResult | { ok: false; reason: "signed_out" }> {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return { ok: false, reason: "bad_url" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (typeof userId !== "string") return { ok: false, reason: "signed_out" };

  const [enabled, timeoutMs, maxBytes] = await Promise.all([
    appSettingInt("store_page_read_enabled"),
    appSettingInt("store_page_read_timeout_ms"),
    appSettingInt("store_page_read_max_bytes"),
  ]);

  return lookupStorePage(
    { url, userId },
    { enabled: enabled === 1, timeoutMs, maxBytes },
    {
      fetch: (target, init) => fetch(target, init),
      resolve: async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address),
      log: logEvent,
      now: Date.now,
    },
  );
}
