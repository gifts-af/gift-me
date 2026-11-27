import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAsin, isAmazonHost } from "@gifts-af/core/store-page/link";
import type { Database } from "@gifts-af/core";
import type { AmazonLookupResult } from "./amazon-lookup";
import type { JpegOptions, JpegResult } from "./photo-jpeg";
import type { ImageFetchResult, LookupStorePageResult } from "./store-page-fetch";

/**
 * The daily tick's photo repair: gifts with a link but no photo, or only the
 * guessed Amazon one (often a 1x1 placeholder), are tried again a few at a
 * time. Amazon goes through Zinc's product details (one lookup from the
 * daily ceiling across everyone), other stores through one plain page read
 * (T52: no headless browser, no disguise). A photo found is stored as our
 * own copy in list-photos, the way the extension stores one, so a store
 * can't break it later. A failure waits photo_repair_backoff_days, doubled
 * after each one, and the gift is given up on after
 * photo_repair_max_attempts. photo_repair_enabled is the off switch. The
 * database picks the gifts and their order (photo_repair_candidates).
 * Everything arrives as an argument (E3).
 */

type Field = string | number | boolean | null;

export type PhotoRepairSettings = {
  enabled: boolean;
  perRun: number;
  /** Starts no new gift after this many ms of the run. */
  budgetMs: number;
  /** How long the gifts a run picks stay claimed, so an overlapping run skips them. */
  claimMinutes: number;
  maxAttempts: number;
  backoffDays: number;
  maxAgeDays: number;
  jpeg: JpegOptions;
};

export type PhotoRepairDeps = {
  /** Service role. */
  db: SupabaseClient<Database>;
  /** Zinc product details, taking one lookup from the daily ceiling first. */
  lookUpAmazon: (asin: string, ownerId: string) => Promise<AmazonLookupResult>;
  /** One plain read of the store's page. */
  readPage: (url: string, ownerId: string) => Promise<LookupStorePageResult>;
  download: (url: string) => Promise<ImageFetchResult>;
  toJpeg: (bytes: Buffer, opts: JpegOptions) => Promise<JpegResult>;
  log: (event: string, fields: Record<string, Field>) => void;
  now: () => Date;
};

export type Candidate = {
  item_id: string;
  owner_id: string;
  product_url: string;
  asin: string | null;
  image_url: string | null;
  attempts: number;
};

const BUCKET = "list-photos";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads the settings; any that can't be read throws (T23: no fallback in code). */
export async function photoRepairSettings(read: (key: string) => Promise<number>): Promise<PhotoRepairSettings> {
  const [enabled, perRun, budgetMs, claimMinutes, maxAttempts, backoffDays, maxAgeDays, minPx, widthPx, quality, maxBytes] =
    await Promise.all(
    [
      "photo_repair_enabled",
      "photo_repair_per_run",
      "photo_repair_budget_ms",
      "photo_repair_claim_minutes",
      "photo_repair_max_attempts",
      "photo_repair_backoff_days",
      "photo_repair_max_age_days",
      "photo_repair_min_px",
      "list_photo_width_px",
      "list_photo_jpeg_quality",
      "list_photo_max_bytes",
    ].map(read),
  );
  return { enabled: enabled === 1, perRun, budgetMs, claimMinutes, maxAttempts, backoffDays, maxAgeDays, jpeg: { minPx, widthPx, quality, maxBytes } };
}

/** After failure number `attempts` (1-based): when to try again, or give up. Waits double: 1, 2, 4, 8 days. */
export function afterFailure(
  attempts: number,
  s: Pick<PhotoRepairSettings, "maxAttempts" | "backoffDays">,
  now: Date,
): { nextAttemptAt: Date; gaveUp: boolean } {
  return {
    nextAttemptAt: new Date(now.getTime() + s.backoffDays * 2 ** (attempts - 1) * DAY_MS),
    gaveUp: attempts >= s.maxAttempts,
  };
}

/**
 * Outcomes that say nothing about the gift (a switch, the daily ceiling): no attempt is counted.
 * Neither is gift_changed: an edit during the run starts the gift over.
 */
const NOT_THE_GIFTS_FAULT = new Set(["off", "not_configured", "over_limit", "image_off"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function repairMissingPhotos(
  readSetting: (key: string) => Promise<number>,
  deps: PhotoRepairDeps,
): Promise<{ repaired: number; failed: number }> {
  let s: PhotoRepairSettings;
  try {
    s = await photoRepairSettings(readSetting);
  } catch {
    deps.log("lists.photo_repair_skipped", { reason: "settings" });
    return { repaired: 0, failed: 0 };
  }
  if (!s.enabled) return { repaired: 0, failed: 0 };

  const lists = deps.db.schema("lists");
  const found = await lists.rpc("photo_repair_candidates", {
    p_limit: s.perRun,
    p_max_age_days: s.maxAgeDays,
    p_claim_minutes: s.claimMinutes,
  });
  if (found.error) throw new Error(`Finding gifts to repair failed: ${found.error.message}`);

  let repaired = 0;
  let failed = 0;
  // Amazon lookups or page reads switched off, or today's lookups used up: stop asking this run.
  const closed = { amazon: false, store: false };
  const started = deps.now().getTime();
  for (const c of (found.data ?? []) as Candidate[]) {
    // The run shares the tick's time limit with the rounds: past its budget, the rest wait a day.
    if (deps.now().getTime() - started >= s.budgetMs) break;
    const asin = amazonAsin(c);
    const kind = asin ? "amazon" : "store";
    if (closed[kind]) continue;
    const store = hostOf(c.product_url);
    const attempt = c.attempts + 1;
    const outcome = await repairOne(c, asin, s, deps);
    if (outcome === "repaired") {
      repaired++;
      deps.log("lists.photo_repaired", { item_id: c.item_id, user_id: c.owner_id, outcome, store, attempt });
      continue;
    }
    if (NOT_THE_GIFTS_FAULT.has(outcome) || outcome === "gift_changed") {
      // Photo downloads off stops both kinds; the rest stop only their own.
      if (outcome === "image_off") closed.amazon = closed.store = true;
      else if (outcome !== "gift_changed") closed[kind] = true;
      deps.log("lists.photo_repair_failed", { item_id: c.item_id, user_id: c.owner_id, outcome, store, attempt: c.attempts });
      continue;
    }
    failed++;
    const next = afterFailure(attempt, s, deps.now());
    const saved = await lists.from("photo_repairs").upsert({
      item_id: c.item_id,
      attempts: attempt,
      next_attempt_at: next.nextAttemptAt.toISOString(),
      last_outcome: outcome,
      gave_up_at: next.gaveUp ? deps.now().toISOString() : null,
    });
    // A gift removed during the run has no row to key on (23503): nothing to keep.
    if (saved.error && saved.error.code !== "23503") throw new Error(`Saving a photo repair failed: ${saved.error.message}`);
    deps.log("lists.photo_repair_failed", {
      item_id: c.item_id,
      user_id: c.owner_id,
      outcome,
      store,
      attempt,
      gave_up: next.gaveUp,
    });
  }
  return { repaired, failed };
}

/** The ASIN, only for a link on an Amazon host (as listGiftRoute decides): another store's id-shaped path isn't one. */
function amazonAsin(c: Candidate): string | null {
  let url: URL;
  try {
    url = new URL(c.product_url);
  } catch {
    return null;
  }
  if (!isAmazonHost(url.hostname)) return null;
  return c.asin ?? extractAsin(url.pathname);
}

/** "repaired", or a short failure code for the log and photo_repairs.last_outcome. */
async function repairOne(c: Candidate, asin: string | null, s: PhotoRepairSettings, deps: PhotoRepairDeps): Promise<string> {
  let imageUrl: string | null;
  try {
    if (asin) {
      const r = await deps.lookUpAmazon(asin, c.owner_id);
      if (!r.ok) return r.reason;
      imageUrl = r.product.imageUrl;
    } else {
      const r = await deps.readPage(c.product_url, c.owner_id);
      if (!r.ok) return r.reason;
      imageUrl = r.product.imageUrl;
    }
  } catch {
    return "unavailable";
  }
  if (!imageUrl) return "no_image";

  const image = await deps.download(imageUrl);
  if (!image.ok) return `image_${image.reason}`;
  const jpeg = await deps.toJpeg(image.bytes, s.jpeg);
  if (!jpeg.ok) return jpeg.reason;

  // Like the extension: queue the file before uploading it, so a gift that's gone (or a
  // failed save) still has it cleaned up; the gift taking the photo takes it off the queue.
  const path = `${c.item_id}.jpg`;
  const lists = deps.db.schema("lists");
  const queued = await lists.rpc("queue_photo", { p_item_id: c.item_id });
  if (queued.error) return "store_failed";
  const bucket = deps.db.storage.from(BUCKET);
  const uploaded = await bucket.upload(path, jpeg.jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return "store_failed";
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;

  // Only if the gift is still as we found it (an edit in the meantime wins), and the list's
  // version moves so an open My list tab can't save the old photo back.
  const saved = await lists.rpc("save_repaired_photo", {
    p_item_id: c.item_id,
    p_product_url: c.product_url,
    p_old_image_url: c.image_url as string,
    p_new_image_url: publicUrl,
  });
  if (saved.error) return "store_failed";
  return saved.data === true ? "repaired" : "gift_changed";
}
