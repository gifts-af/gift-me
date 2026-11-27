import { lookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { appSettingInt } from "@/lib/app-settings";
import { logEvent } from "@/lib/log";
import { amazonPasteDetails } from "@/modules/concierge";
import { lookUpAmazonProduct } from "./amazon-lookup";
import { toListPhotoJpeg } from "./photo-jpeg";
import { repairMissingPhotos } from "./photo-repair";
import { fetchStoreImage, lookupStorePage, type StorePageDeps } from "./store-page-fetch";

/**
 * The daily tick's photo repair with its real parts: the paste lookup's Zinc call and event
 * (each lookup counted against amazon_paste_lookups_per_day_total and logged at
 * zinc_lookup_cents), the store-page reader with its guards, and the list-photos bucket. The
 * route passes the service-role client and the app's Zinc key (E3).
 */
export async function runPhotoRepair(
  admin: SupabaseClient<Database>,
  zinc: { base: string; key: string } | null,
): Promise<{ repaired: number; failed: number }> {
  const read = (key: string) => appSettingInt(key, admin);
  const web: StorePageDeps = {
    fetch: (target, init) => fetch(target, init),
    resolve: async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address),
  };
  const pageLimits = async () => {
    const [enabled, timeoutMs, maxBytes] = await Promise.all([
      read("store_page_read_enabled"),
      read("store_page_read_timeout_ms"),
      read("store_page_read_max_bytes"),
    ]);
    return { enabled: enabled === 1, timeoutMs, maxBytes };
  };

  return repairMissingPhotos(read, {
    db: admin,
    async lookUpAmazon(asin, ownerId) {
      const [enabled, timeoutMs, lookupCents] = await Promise.all([
        read("amazon_paste_lookup_enabled"),
        read("amazon_paste_lookup_timeout_ms"),
        read("zinc_lookup_cents"),
      ]);
      const http = zinc ? { base: zinc.base, timeoutMs, fetch } : null;
      return lookUpAmazonProduct(
        { asin, userId: ownerId },
        { enabled: enabled === 1, timeoutMs, lookupCents },
        {
          takeQuota: async () => {
            const { data, error } = await admin.schema("lists").rpc("take_repair_amazon_lookup");
            if (error) throw Object.assign(new Error("take_repair_amazon_lookup failed"), { code: error.code });
            return data === true;
          },
          details: http && zinc ? (id, takeQuota, signal) => amazonPasteDetails(http, zinc.key, id, takeQuota, signal) : null,
          log: logEvent,
          now: Date.now,
        },
      );
    },
    async readPage(url, ownerId) {
      return lookupStorePage({ url, userId: ownerId }, await pageLimits(), { ...web, log: logEvent, now: Date.now });
    },
    async download(url) {
      // Store fetches switched off covers photo downloads too.
      const { enabled, timeoutMs, maxBytes } = await pageLimits();
      if (!enabled) return { ok: false, reason: "off" };
      return fetchStoreImage(url, { timeoutMs, maxBytes }, web);
    },
    toJpeg: toListPhotoJpeg,
    log: logEvent,
    now: () => new Date(),
  });
}
