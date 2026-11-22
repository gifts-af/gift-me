"use server";

import type { Gift } from "@/modules/lists/lib/lists";
import {
  MAX_VERSION_LENGTH,
  saveChecked,
  toRow,
  type ListRow,
  type SaveListResult,
} from "@/modules/lists/lib/save-list";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";

/**
 * Replaces the caller's list with `items`, made from the list at `version`,
 * creating the list on first save. A save from an out-of-date version is
 * refused with the latest list (`stale`), for the app to re-apply its own
 * changes on (ALL-127). Reachable by direct POST like any Server Action, so it
 * re-checks auth and re-validates everything the client sends; RLS is the
 * backstop behind that.
 */
export async function saveList(input: {
  listId: string | null;
  version: string | null;
  items: Partial<Gift>[];
}): Promise<SaveListResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, error: "Sign in to save your list." };

  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) return { ok: false, error: "That list couldn't be read." };
  // The same setting the database enforces (ALL-142), so the person gets a plain message first.
  const maxItems = await appSettingInt("list_max_items", supabase);
  if (items.length > maxItems) {
    return { ok: false, error: `A list can hold up to ${maxItems} gifts.` };
  }

  const rows = items.map(toRow);
  if (rows.some((row) => row === null)) {
    return { ok: false, error: "One of the gifts has a missing name or an invalid price." };
  }

  const listId = typeof input.listId === "string" ? input.listId : null;
  const version =
    typeof input.version === "string" && input.version.length <= MAX_VERSION_LENGTH ? input.version : null;

  return saveChecked(supabase, userId, { listId, version, rows: rows as ListRow[] });
}
