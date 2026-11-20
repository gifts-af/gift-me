import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { logEvent } from "@/lib/log";

/** Paths taken per run; a bigger backlog carries over to the next day. */
const BATCH = 500;
/** An add still in flight may have just queued its own photo, so only older rows are taken. */
const MIN_AGE = "1 hour";

/**
 * The daily clear-out of photos whose gift is gone (ALL-78): takes the paths queued over an hour
 * ago, removes them from the list-photos bucket, and only then forgets them. A file that is
 * already missing counts as removed. A failed remove forgets nothing, so tomorrow retries.
 */
export async function removeDeletedPhotos(db: SupabaseClient<Database>): Promise<{ removed: number }> {
  const lists = db.schema("lists");
  const taken = await lists.rpc("take_photo_deletions", { p_limit: BATCH, p_older_than: MIN_AGE });
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
