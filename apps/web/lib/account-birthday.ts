import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { errorFields, logEvent } from "@/lib/log";

// Your own birthday, month and day: account data, like your address, so it
// sits outside both modules (T19). Row-level security keeps the row to you;
// people with your list's link get it through lists.owner_birthday. Logs carry
// the user id and an error code only, never the date (E6).

export type BirthdayDb = Pick<SupabaseClient<Database>, "from">;
export type Birthday = { month: number; day: number };
/** `unavailable` means the read failed, which must never look like having none. */
export type MyBirthday = { kind: "unavailable" } | { kind: "none" } | ({ kind: "saved" } & Birthday);

const TABLE = "account_birthdays";

function failed(userId: string, step: string, error: { code?: string }): void {
  logEvent("account_birthday.failed", { user_id: userId, step, code: error.code ?? null });
}

export async function getMyBirthday(db: BirthdayDb, userId: string): Promise<MyBirthday> {
  const { data, error } = await db.from(TABLE).select("month, day").eq("user_id", userId).maybeSingle();
  if (error) {
    failed(userId, "read", error);
    return { kind: "unavailable" };
  }
  return data ? { kind: "saved", month: data.month, day: data.day } : { kind: "none" };
}

export async function saveMyBirthday(db: BirthdayDb, userId: string, { month, day }: Birthday): Promise<boolean> {
  const { error } = await db.from(TABLE).upsert({ user_id: userId, month, day }, { onConflict: "user_id" });
  if (error) {
    failed(userId, "save", error);
    return false;
  }
  logEvent("account_birthday.saved", { user_id: userId });
  return true;
}

export async function removeMyBirthday(db: BirthdayDb, userId: string): Promise<boolean> {
  const { error } = await db.from(TABLE).delete().eq("user_id", userId);
  if (error) {
    failed(userId, "remove", error);
    return false;
  }
  logEvent("account_birthday.removed", { user_id: userId });
  return true;
}

/**
 * Whether a saved birthday does anything: the same two switches
 * lists.owner_birthday checks. A setting that can't be read counts as off, so
 * it never breaks a page.
 */
export async function birthdaySharingOn(setting: (key: string) => Promise<number>): Promise<boolean> {
  try {
    const values = await Promise.all([setting("list_birthday_enabled"), setting("list_link_card_enabled")]);
    return values.every((value) => value === 1);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("account_birthday.setting_failed", errorFields(error));
    return false;
  }
}
