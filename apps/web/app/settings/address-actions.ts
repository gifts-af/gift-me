"use server";

import { revalidatePath } from "next/cache";
import {
  parseMyAddressForm,
  removeMyAddress,
  saveMyAddress,
  setSharing,
  type AccountAddressDb,
  type AccountAddressResult,
} from "@/lib/account-address";
import { createClient } from "@/lib/supabase/server";

const SIGN_IN_AGAIN: AccountAddressResult = { ok: false, error: "Your session ended. Sign in again." };
const TRY_AGAIN: AccountAddressResult = { ok: false, error: "That didn't save. Try again." };

// The user id always comes from the session, never from the form (AC-6).
async function session(): Promise<{ db: AccountAddressDb; userId: string } | null> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { db, userId } : null;
}

function refresh(): AccountAddressResult {
  revalidatePath("/settings");
  revalidatePath("/lists");
  return { ok: true };
}

/** Saves your own address. The form field `share=1` also turns sharing on, in one write (AC-9). */
export async function saveMyAddressAction(form: FormData): Promise<AccountAddressResult> {
  const parsed = parseMyAddressForm(form);
  if (!parsed.ok) return { ok: false, error: "Check the address below.", fields: parsed.errors };
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  const opts = form.get("share") === "1" ? ({ share: true } as const) : undefined;
  return (await saveMyAddress(s.db, s.userId, parsed.value, new Date(), opts)) ? refresh() : TRY_AGAIN;
}

export async function removeMyAddressAction(): Promise<AccountAddressResult> {
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  return (await removeMyAddress(s.db, s.userId)) ? refresh() : TRY_AGAIN;
}

export async function setSharingAction(on: boolean): Promise<AccountAddressResult> {
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  const result = await setSharing(s.db, s.userId, on === true);
  if (result === "no_address") {
    // Turning off with no address already got what it asked for.
    const refreshed = refresh();
    return on === true ? { ok: false, error: "Add your address first." } : refreshed;
  }
  return result === "ok" ? refresh() : TRY_AGAIN;
}
