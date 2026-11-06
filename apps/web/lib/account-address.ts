import { checkOwnAddress, type Address, type AddressField, type Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/log";

// Your own address (decision 41, ALL-63): account data shared by both products,
// so it sits outside either module (T19). Every function takes the signed-in
// client; row-level security keeps it to your own row. Logs carry the user id
// and an error code only (E6): a database error's text can hold the failing row.

export type AccountAddressDb = Pick<SupabaseClient<Database>, "from">;

/** `unavailable` means the read failed, which must never look like having no address. */
export type MyAddress = { kind: "unavailable" } | { kind: "none" } | { kind: "saved"; address: Address; shared: boolean };
export type Sharing =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "off"; city: string; state: string }
  | { kind: "on"; city: string; state: string };
export type AccountAddressResult = { ok: true } | { ok: false; error: string; fields?: Partial<Record<AddressField, string>> };

const FIELDS: AddressField[] = ["firstName", "lastName", "line1", "line2", "city", "state", "zip"];
const TABLE = "account_addresses";

function failed(userId: string, step: string, error: { code?: string }): void {
  logEvent("account_address_failed", { user_id: userId, step, code: error.code ?? null });
}

export async function getMyAddress(db: AccountAddressDb, userId: string): Promise<MyAddress> {
  const { data, error } = await db
    .from(TABLE)
    .select("recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, share_for_gifts")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    failed(userId, "read", error);
    return { kind: "unavailable" };
  }
  if (!data) return { kind: "none" };
  return {
    kind: "saved",
    shared: data.share_for_gifts,
    address: {
      firstName: data.recipient_first_name,
      lastName: data.recipient_last_name,
      line1: data.address_line1,
      line2: data.address_line2,
      city: data.city,
      state: data.state,
      zip: data.zip,
    },
  };
}

/** For the list page, which reads no street or name (AC-12). */
export async function getSharing(db: AccountAddressDb, userId: string): Promise<Sharing> {
  const { data, error } = await db.from(TABLE).select("city, state, share_for_gifts").eq("user_id", userId).maybeSingle();
  if (error) {
    failed(userId, "read_sharing", error);
    return { kind: "unavailable" };
  }
  if (!data) return { kind: "none" };
  return { kind: data.share_for_gifts ? "on" : "off", city: data.city, state: data.state };
}

/** Leaving `share_for_gifts` out means changing an address never changes sharing (AC-3). */
export async function saveMyAddress(
  db: AccountAddressDb,
  userId: string,
  a: Address,
  now: Date,
  opts?: { share: true },
): Promise<boolean> {
  const { error } = await db.from(TABLE).upsert(
    {
      user_id: userId,
      recipient_first_name: a.firstName,
      recipient_last_name: a.lastName,
      address_line1: a.line1,
      address_line2: a.line2,
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: "US",
      address_checked_at: now.toISOString(),
      ...(opts?.share ? { share_for_gifts: true } : {}),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    failed(userId, "save", error);
    return false;
  }
  logEvent("account_address_saved", { user_id: userId, shared: opts?.share === true });
  return true;
}

export async function removeMyAddress(db: AccountAddressDb, userId: string): Promise<boolean> {
  const { error } = await db.from(TABLE).delete().eq("user_id", userId);
  if (error) {
    failed(userId, "remove", error);
    return false;
  }
  logEvent("account_address_removed", { user_id: userId });
  return true;
}

/** `no_address` when there's no row to change: sharing can't exist without an address (AC-10). */
export async function setSharing(db: AccountAddressDb, userId: string, on: boolean): Promise<"ok" | "no_address" | "failed"> {
  const { data, error } = await db.from(TABLE).update({ share_for_gifts: on }).eq("user_id", userId).select("user_id");
  if (error) {
    failed(userId, "sharing", error);
    return "failed";
  }
  if (!data || data.length === 0) return "no_address";
  logEvent("address_sharing_changed", { user_id: userId, on });
  return "ok";
}

/** Anything but text in a field counts as empty (E4). */
export function parseMyAddressForm(f: FormData): ReturnType<typeof checkOwnAddress> {
  const value = (k: AddressField) => {
    const v = f.get(k);
    return typeof v === "string" ? v : "";
  };
  return checkOwnAddress(Object.fromEntries(FIELDS.map((k) => [k, value(k)])));
}
