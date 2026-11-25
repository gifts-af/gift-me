"use server";

import { revalidatePath } from "next/cache";
import { birthdaySharingOn, removeMyBirthday, saveMyBirthday, type BirthdayDb } from "@/lib/account-birthday";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { parseMonthDay, type SaveResult } from "@/modules/concierge";

const SIGN_IN_AGAIN: SaveResult = { ok: false, error: "Your session ended. Sign in again." };

// The user id always comes from the session, never from the form.
async function session(): Promise<{ db: BirthdayDb; userId: string } | null> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { db, userId } : null;
}

function refresh(): SaveResult {
  revalidatePath("/settings");
  revalidatePath("/settings/birthday");
  revalidatePath("/lists");
  return { ok: true };
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveBirthdayAction(form: FormData): Promise<SaveResult> {
  const parsed = parseMonthDay(text(form, "birthdayMonth"), text(form, "birthdayDay"));
  if (!parsed.ok) return parsed;
  if (!parsed.value) return { ok: false, error: "Pick a month and a day." };
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  if (!(await birthdaySharingOn(appSettingInt))) return { ok: false, error: "This is switched off right now." };
  return (await saveMyBirthday(s.db, s.userId, parsed.value)) ? refresh() : { ok: false, error: "That didn't save. Try again." };
}

export async function removeBirthdayAction(): Promise<SaveResult> {
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  return (await removeMyBirthday(s.db, s.userId)) ? refresh() : { ok: false, error: "That didn't work. Try again." };
}
