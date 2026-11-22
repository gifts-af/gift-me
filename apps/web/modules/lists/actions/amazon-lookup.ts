"use server";

import { appSettingInt } from "@/lib/app-settings";
import { logEvent } from "@/lib/log";
import { zincAppKey } from "@/lib/wiring";
import { createClient } from "@/lib/supabase/server";
import { amazonPasteDetails } from "@/modules/concierge";
import { lookUpAmazonProduct, type AmazonLookupResult } from "@/modules/lists/lib/amazon-lookup";

/**
 * Looks up a pasted Amazon link's product through Zinc, for its real name,
 * price and photo (ALL-141). Paste-a-link on My list is its only caller.
 * Reachable by direct POST like any Server Action, so it checks the input and
 * sign-in itself. The daily allowance is taken as the signed-in person, so it
 * counts against them. The work is in lookUpAmazonProduct(); this only builds
 * what it needs (E3).
 */
export async function lookUpAmazon(asin: unknown): Promise<AmazonLookupResult> {
  if (typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin)) return { ok: false, reason: "bad_asin" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (typeof userId !== "string") return { ok: false, reason: "signed_out" };

  const [enabled, timeoutMs, lookupCents] = await Promise.all([
    appSettingInt("amazon_paste_lookup_enabled", supabase),
    appSettingInt("amazon_paste_lookup_timeout_ms", supabase),
    appSettingInt("zinc_lookup_cents", supabase),
  ]);

  const zinc = zincAppKey();

  return lookUpAmazonProduct(
    { asin, userId },
    { enabled: enabled === 1, timeoutMs, lookupCents },
    {
      takeQuota: async () => {
        const { data, error } = await supabase.schema("lists").rpc("take_amazon_lookup");
        if (error) throw Object.assign(new Error("take_amazon_lookup failed"), { code: error.code });
        return data === true;
      },
      details: zinc
        ? (id, takeQuota, signal) => amazonPasteDetails({ base: zinc.base, timeoutMs, fetch }, zinc.key, id, takeQuota, signal)
        : null,
      log: logEvent,
      now: Date.now,
    },
  );
}
