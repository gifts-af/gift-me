import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { errorFields, logEvent } from "@/lib/log";
import { SIZE_KINDS, type SizeKind } from "@/lib/size-kinds";

// Your own sizes and favorite color: account data, so it sits outside both
// modules (T19). Row-level security keeps the row to you; people with your
// list's link get only the shared ones, through lists.owner_sizes. Logs carry
// the user id and an error code only, never a value or a label (E6).

export type SizesDb = Pick<SupabaseClient<Database>, "from">;
export type SizeItem = { value: string; shared: boolean };
/** `unavailable` means the read failed, which must never look like having none. */
export type MySizes = { status: "unavailable" } | { status: "loaded"; items: Record<SizeKind, SizeItem | null> };
/** The whole row, as the table stores it: every kind and its `_shared` flag. */
export type SizesRow = { [K in SizeKind]: string | null } & { [K in SizeKind as `${K}_shared`]: boolean };

const TABLE = "account_sizes";
const MAX_LENGTH = 30;
const COLUMNS = SIZE_KINDS.flatMap(({ kind }) => [kind, `${kind}_shared`]).join(", ");

function failed(userId: string, step: string, error: { code?: string }): void {
  logEvent("account_sizes.failed", { user_id: userId, step, code: error.code ?? null });
}

export async function getMySizes(db: SizesDb, userId: string): Promise<MySizes> {
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) {
    failed(userId, "read", error);
    return { status: "unavailable" };
  }
  const row = data as unknown as Partial<SizesRow> | null;
  const items = {} as Record<SizeKind, SizeItem | null>;
  for (const { kind } of SIZE_KINDS) {
    const value = row?.[kind];
    items[kind] = value ? { value, shared: row?.[`${kind}_shared`] === true } : null;
  }
  return { status: "loaded", items };
}

export type ParsedSizes = { ok: true; row: SizesRow } | { ok: false; errors: Partial<Record<SizeKind, string>> };

// Counted in code points, as Postgres char_length counts them; .length would
// count an emoji as two and refuse a value the database accepts.
function valueError(value: string): string | null {
  if ([...value].length > MAX_LENGTH) return `Use ${MAX_LENGTH} characters or fewer.`;
  if (/[\u0000-\u001f\u007f]/.test(value)) return "Take out line breaks and tabs.";
  return null;
}

export function parseSizesForm(form: FormData): ParsedSizes {
  const row: Record<string, string | null | boolean> = {};
  const errors: Partial<Record<SizeKind, string>> = {};
  for (const { kind } of SIZE_KINDS) {
    const raw = form.get(kind);
    const value = typeof raw === "string" ? raw.trim() : "";
    const error = valueError(value);
    if (error) errors[kind] = error;
    row[kind] = value || null;
    // Sharing an empty box means nothing, so it's dropped rather than refused.
    row[`${kind}_shared`] = value !== "" && form.get(`${kind}_shared`) === "on";
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, row: row as SizesRow };
}

export async function saveMySizes(db: SizesDb, userId: string, row: SizesRow): Promise<boolean> {
  // Nothing left to keep: a row of nulls would only linger, so it goes.
  if (SIZE_KINDS.every(({ kind }) => row[kind] === null)) return removeMySizes(db, userId);
  const { error } = await db.from(TABLE).upsert({ ...row, user_id: userId }, { onConflict: "user_id" });
  if (error) {
    failed(userId, "save", error);
    return false;
  }
  logEvent("account_sizes.saved", { user_id: userId });
  return true;
}

/** One size typed on My list (T100): the same rules as a Settings box, but empty is refused. */
export function parseOneSize(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Type a size, or pick Not now." };
  const error = valueError(value);
  return error ? { ok: false, error } : { ok: true, value };
}

export type OneSizeSave = "saved" | "already" | "failed";

/**
 * Saves one size, shared, only while that size is still empty (T100): a size
 * saved meanwhile in Settings or another tab, shared or not, is never
 * overwritten. Only that column and its switch are written, so every other
 * size and switch stays as it was. "already" means it was filled meanwhile.
 */
export async function saveOneSize(db: SizesDb, userId: string, kind: SizeKind, value: string): Promise<OneSizeSave> {
  // A computed key widens to an index signature, which the row type refuses.
  const fields = { [kind]: value, [`${kind}_shared`]: true } as Partial<SizesRow>;
  const updated = await db.from(TABLE).update(fields).eq("user_id", userId).is(kind, null).select("user_id");
  if (updated.error) {
    failed(userId, "save_one", updated.error);
    return "failed";
  }
  if (updated.data.length === 0) {
    // No row with that size empty: either no row yet, or the size is filled.
    const inserted = await db.from(TABLE).insert({ ...fields, user_id: userId } as SizesRow & { user_id: string });
    if (inserted.error?.code === "23505") return "already";
    if (inserted.error) {
      failed(userId, "save_one", inserted.error);
      return "failed";
    }
  }
  logEvent("account_sizes.saved", { user_id: userId, kind, source: "my_list" });
  return "saved";
}

export async function removeMySizes(db: SizesDb, userId: string): Promise<boolean> {
  const { error } = await db.from(TABLE).delete().eq("user_id", userId);
  if (error) {
    failed(userId, "remove", error);
    return false;
  }
  logEvent("account_sizes.removed", { user_id: userId });
  return true;
}

/**
 * Whether saved sizes do anything: the same two switches lists.owner_sizes
 * checks. A setting that can't be read counts as off, so it never breaks a page.
 */
export async function sizesSharingOn(setting: (key: string) => Promise<number>): Promise<boolean> {
  try {
    const values = await Promise.all([setting("list_sizes_enabled"), setting("list_link_card_enabled")]);
    return values.every((value) => value === 1);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("account_sizes.setting_failed", errorFields(error));
    return false;
  }
}
