import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";

/**
 * The daily clear-out of photos whose gift is gone (ALL-78): takes up to
 * list_photo_cleanup_batch paths queued at least list_photo_cleanup_min_age_minutes
 * ago (an add still in flight may have just queued its own photo), removes them
 * from the list-photos bucket, and only then forgets them. A bigger backlog
 * carries over to the next day. A file that is already missing counts as
 * removed. A failed remove forgets nothing, so tomorrow retries. A setting that
 * can't be read skips the day (T23: no fallback in code).
 */
export async function removeDeletedPhotos(
  db: SupabaseClient<Database>,
  readSetting: (key: string) => Promise<number>,
): Promise<{ removed: number }> {
  let batch: number;
  let minAgeMinutes: number;
  try {
    [batch, minAgeMinutes] = await Promise.all([
      readSetting("list_photo_cleanup_batch"),
      readSetting("list_photo_cleanup_min_age_minutes"),
    ]);
  } catch {
    logEvent("list.photo_cleanup_skipped", { reason: "settings" });
    return { removed: 0 };
  }

  const lists = db.schema("lists");
  const taken = await lists.rpc("take_photo_deletions", { p_limit: batch, p_older_than: `${minAgeMinutes} minutes` });
  if (taken.error) throw new Error(`Taking queued photos failed: ${taken.error.message}`);
  const paths = taken.data ?? [];
  if (paths.length === 0) return { removed: 0 };

  const removed = await db.storage.from("list-photos").remove(paths);
  if (removed.error) {
    logEvent("list.photos_left", { count: paths.length });
    throw new Error(`Removing ${paths.length} list photos failed: ${removed.error.message}`);
  }
  const forgotten = await lists.rpc("forget_photo_deletions", { p_paths: paths });
  if (forgotten.error) throw new Error(`Forgetting removed photos failed: ${forgotten.error.message}`);
  return { removed: paths.length };
}
