import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/log";
import { MAX_PRICE_CENTS } from "./format.js";
import { readList, UUID_PATTERN, type Gift } from "./lists";

// Saving My list, shared by the saveList action and the close route
// (app/api/lists/save-on-close). Every save goes through
// lists.save_list_checked, which refuses one made from an out-of-date version
// (ALL-127, T74).

export const MAX_ITEMS = 500;
const MAX_NAME_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
// Postgres prints a timestamptz in well under this.
export const MAX_VERSION_LENGTH = 64;

export type SaveListResult =
  | { ok: true; listId: string; shareToken: string | null; version: string; items: Gift[] }
  // The list changed somewhere else: here is the latest, to re-apply this tab's changes on.
  | { ok: false; stale: true; listId: string; shareToken: string; version: string; items: Gift[] }
  | { ok: false; stale?: undefined; error: string };

export type ListRow = NonNullable<ReturnType<typeof toRow>>;

// Only http(s) links may be stored: anything else (javascript:, data:) would
// be rendered straight into an href or src for the owner later.
function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function cleanShortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function toRow(input: Partial<Gift>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return null;

  const priceCents = input.priceCents;
  if (
    typeof priceCents !== "number" ||
    !Number.isInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > MAX_PRICE_CENTS
  ) {
    return null;
  }

  const addedAt =
    typeof input.addedAt === "number" && Number.isFinite(input.addedAt)
      ? new Date(input.addedAt).toISOString()
      : null;

  return {
    // Sent back so the save can keep the row (and any claim on it) instead
    // of replacing it. A new gift keeps its client uuid when it is free.
    id: typeof input.id === "string" && UUID_PATTERN.test(input.id) ? input.id : null,
    name,
    price_cents: priceCents,
    image_url: cleanUrl(input.imageUrl),
    product_url: cleanUrl(input.productUrl),
    asin: cleanShortText(input.asin, 20),
    source: cleanShortText(input.source, 40) ?? "manual",
    added_at: addedAt,
  };
}

const COULD_NOT_SAVE = "Your list couldn't be saved. Try again.";

/**
 * Saves `rows` as the caller's list, made from `version`. With no list id it
 * creates the list, unless the caller already has one. A refusal comes back
 * as `stale` with the latest list, read in one query with its version.
 */
export async function saveChecked(
  db: SupabaseClient,
  userId: string,
  input: { listId: string | null; version: string | null; rows: ListRow[] },
): Promise<SaveListResult> {
  const { data, error } = await db.schema("lists").rpc("save_list_checked", {
    p_list_id: input.listId,
    p_title: null,
    p_items: input.rows,
    p_expected: input.version,
  });

  if (error?.code === "GL409") {
    const latest = await readList(db, input.listId);
    if (!latest.ok || !latest.list) return { ok: false, error: COULD_NOT_SAVE };
    logEvent("list_save_stale", { list_id: latest.list.id, user_id: userId });
    return {
      ok: false,
      stale: true,
      listId: latest.list.id,
      shareToken: latest.list.shareToken,
      version: latest.list.version,
      items: latest.items,
    };
  }

  const saved = data as { id?: unknown; updated_at?: unknown } | null;
  if (error || typeof saved?.id !== "string" || typeof saved.updated_at !== "string") {
    console.error("save_list_checked failed", error);
    return { ok: false, error: COULD_NOT_SAVE };
  }

  // The version is the one this save made. If another tab saved in the
  // meantime the rows read here are newer, and this tab's next save is
  // refused and re-applied on top, so nothing is lost either way.
  const reread = await readList(db, saved.id);
  if (!reread.ok || !reread.list) {
    return { ok: false, error: "Your list was saved, but couldn't be reloaded. Refresh the page." };
  }
  return {
    ok: true,
    listId: saved.id,
    shareToken: reread.list.shareToken,
    version: saved.updated_at,
    items: reread.items,
  };
}

export type RemoveOutcome = "saved" | "stale" | "not_found" | "error";

/**
 * Drops `removeIds` from the caller's list: the close route's job, when a tab
 * goes with a remove still held for Undo. It reads the current gifts and saves
 * the rest through the same checked path. Removing by id is safe on any newer
 * version, so it works from the latest rather than the tab's, and tries once
 * more if another save lands between the read and the write.
 * `behind` says the tab's version was already out of date.
 */
export async function removeGifts(
  db: SupabaseClient,
  userId: string,
  input: { listId: string; version: string; removeIds: string[] },
): Promise<{ outcome: RemoveOutcome; behind: boolean }> {
  const current = await readList(db, input.listId);
  if (!current.ok) return { outcome: "error", behind: false };
  if (!current.list) return { outcome: "not_found", behind: false };
  const behind = current.list.version !== input.version;

  const remove = new Set(input.removeIds);
  let base = { version: current.list.version, items: current.items };
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = base.items.filter((g) => !remove.has(g.id)).map(toRow);
    // Rows read back from the database always pass; a null would mean a bad row.
    if (rows.some((row) => row === null)) return { outcome: "error", behind };
    const result = await saveChecked(db, userId, {
      listId: input.listId,
      version: base.version,
      rows: rows as ListRow[],
    });
    if (result.ok) return { outcome: "saved", behind };
    if (!result.stale) return { outcome: "error", behind };
    base = result;
  }
  return { outcome: "stale", behind };
}
