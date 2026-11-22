import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/log";
import { MAX_PRICE_CENTS } from "./format";
import { readList, rowToGift, UUID_PATTERN, type Gift, type ListItemRow } from "./lists";

// Saving My list, shared by the saveList action and the close route
// (app/api/lists/save-on-close). Every save goes through
// lists.save_list_checked, which refuses one made from an out-of-date version
// (ALL-127, T74).

export const MAX_NAME_LENGTH = 300;
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
export function cleanUrl(value: unknown): string | null {
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

// A gift's photo, by the database's rule (lists.is_allowed_image_url, ALL-142):
// https, or http on this machine (local Supabase storage). Any other http photo
// is moved to https; anything else is dropped. cleanUrl's `new URL().href`
// lower-cases the scheme and host and adds the path's "/", which is what lets
// these two simple patterns match the database's regex.
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?\//;
export function cleanImageUrl(value: unknown): string | null {
  const url = cleanUrl(value);
  if (!url || url.startsWith("https://") || LOCAL_HTTP.test(url)) return url;
  return `https://${url.slice("http://".length)}`;
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
    image_url: cleanImageUrl(input.imageUrl),
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

  // The gifts come back from the save itself, read under its row lock, so they
  // match its version. A separate read here could include another device's
  // gift under this version, and the app's next merge would remove it.
  const saved = data as { id?: unknown; updated_at?: unknown; share_token?: unknown; items?: unknown } | null;
  if (
    error ||
    typeof saved?.id !== "string" ||
    typeof saved.updated_at !== "string" ||
    !Array.isArray(saved.items)
  ) {
    logEvent("list_save_failed", { user_id: userId, list_id: input.listId, code: errorCode(error) });
    return { ok: false, error: COULD_NOT_SAVE };
  }
  return {
    ok: true,
    listId: saved.id,
    shareToken: typeof saved.share_token === "string" ? saved.share_token : null,
    version: saved.updated_at,
    items: (saved.items as ListItemRow[]).map(rowToGift),
  };
}

/** A Postgres or PostgREST error code, never the message (E6). */
export function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code) ? code : null;
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
): Promise<
  { outcome: "saved"; behind: boolean; version: string } | { outcome: Exclude<RemoveOutcome, "saved">; behind: boolean }
> {
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
    // Behind again if another save landed between the read and this one.
    if (result.ok) return { outcome: "saved", behind: behind || attempt > 0, version: result.version };
    if (!result.stale) return { outcome: "error", behind };
    base = result;
  }
  return { outcome: "stale", behind };
}
