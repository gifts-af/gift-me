import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";

export type InboundCleanup = { cleared: number; imagesRemoved: number };

/**
 * The daily clear-out of notes nobody filed (ALL-31): clears the subject, body and image of
 * "asking" messages whose buttons have all expired, prunes the seen ids and daily events, and
 * deletes the cleared messages' images from the private captures bucket. Filed messages are
 * never touched (their image is the capture's screenshot). The SQL function does the choosing
 * (clear_unfiled_inbound); the paths it returns are already cleared from the rows, so a
 * storage failure logs which files are left, then throws.
 */
export async function clearUnfiledNotes(db: SupabaseClient<Database>): Promise<InboundCleanup> {
  const { data, error } = await db.schema("concierge").rpc("clear_unfiled_inbound");
  if (error) throw new Error(`Clearing unfiled notes failed: ${error.message}`);

  const paths = data.map((r) => r.image_path).filter((p): p is string => typeof p === "string" && p !== "");
  if (paths.length > 0) {
    const removed = await db.storage.from("captures").remove(paths);
    if (removed.error) {
      // The rows no longer name these files, so the log is the only trace (paths are ids, E6).
      logEvent("inbound.note_images_left", { count: paths.length, paths: paths.join(",") });
      throw new Error(`Removing ${paths.length} cleared note images failed: ${removed.error.message}`);
    }
  }
  return { cleared: data.length, imagesRemoved: paths.length };
}
