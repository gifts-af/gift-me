import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";

export type InboundCleanup = { cleared: number; imagesRemoved: number };

/** Paths per log line, so a big backlog doesn't make one giant event. */
const LOG_PATHS_PER_EVENT = 20;

/**
 * The daily clear-out of notes nobody filed (ALL-31): clears the subject and body of "asking"
 * messages whose buttons have all expired, prunes the seen ids and daily events, deletes the
 * cleared messages' images from the private captures bucket, and only then forgets the image
 * paths. A failed delete leaves image_path set, so the next day's run retries it. Filed messages
 * are never touched (their image is the capture's screenshot). The SQL functions do the choosing
 * (clear_unfiled_inbound, forget_inbound_images).
 */
export async function clearUnfiledNotes(db: SupabaseClient<Database>): Promise<InboundCleanup> {
  const concierge = db.schema("concierge");
  const { data, error } = await concierge.rpc("clear_unfiled_inbound");
  if (error) throw new Error(`Clearing unfiled notes failed: ${error.message}`);

  const rows = data.filter((r) => typeof r.image_path === "string" && r.image_path !== "");
  if (rows.length > 0) {
    const removed = await db.storage.from("captures").remove(rows.map((r) => r.image_path));
    if (removed.error) {
      // The rows still name the files, so tomorrow retries; the log says what is waiting (ids only, E6).
      logEvent("inbound.note_images_left", { count: rows.length });
      for (let i = 0; i < rows.length; i += LOG_PATHS_PER_EVENT) {
        logEvent("inbound.note_images_left_paths", {
          paths: rows
            .slice(i, i + LOG_PATHS_PER_EVENT)
            .map((r) => r.image_path)
            .join(","),
        });
      }
      throw new Error(`Removing ${rows.length} cleared note images failed: ${removed.error.message}`);
    }
    const forgotten = await concierge.rpc("forget_inbound_images", { p_message_ids: rows.map((r) => r.message_id) });
    if (forgotten.error) throw new Error(`Forgetting the cleared note images failed: ${forgotten.error.message}`);
  }
  return { cleared: data.length, imagesRemoved: rows.length };
}

/**
 * Deletes emailed buttons (action_links) long past expiry and returns how many went. The SQL
 * function reads action_link_prune_days and does nothing when it is unset or 0 (the off switch).
 * Kept apart from clearUnfiledNotes so neither one's failure stops the other.
 */
export async function pruneExpiredActionLinks(db: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("prune_expired_action_links");
  if (error) throw new Error(`Pruning expired action links failed: ${error.message}`);
  return data;
}

/**
 * Blanks tracking numbers on orders long past delivery and returns how many orders were cleared.
 * The SQL function reads tracking_prune_days and does nothing at 0 (the off switch); it raises when
 * the setting is missing, so a lost setting shows up in the log instead of keeping numbers forever.
 */
export async function pruneTrackingNumbers(db: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await db.schema("concierge").rpc("prune_tracking_numbers");
  if (error) throw new Error(`Pruning tracking numbers failed: ${error.message}`);
  return data;
}
