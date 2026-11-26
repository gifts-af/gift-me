"use server";

import { revalidatePath } from "next/cache";
import { parseSizesForm, removeMySizes, saveMySizes, sizesSharingOn, type SizesDb } from "@/lib/account-sizes";
import { appSettingInt } from "@/lib/app-settings";
import type { SizeKind } from "@/lib/size-kinds";
import { createClient } from "@/lib/supabase/server";

export type SizesResult = { ok: true } | { ok: false; error: string; fieldErrors?: Partial<Record<SizeKind, string>> };

const SIGN_IN_AGAIN: SizesResult = { ok: false, error: "Your session ended. Sign in again." };

// The user id always comes from the session, never from the form.
async function session(): Promise<{ db: SizesDb; userId: string } | null> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { db, userId } : null;
}

function refresh(): SizesResult {
  revalidatePath("/settings");
  revalidatePath("/settings/sizes");
  return { ok: true };
}

export async function saveSizesAction(form: FormData): Promise<SizesResult> {
  const parsed = parseSizesForm(form);
  if (!parsed.ok) return { ok: false, error: "Fix the boxes marked below.", fieldErrors: parsed.errors };
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  if (!(await sizesSharingOn(appSettingInt))) return { ok: false, error: "This is switched off right now." };
  return (await saveMySizes(s.db, s.userId, parsed.row)) ? refresh() : { ok: false, error: "That didn't save. Try again." };
}

export async function removeSizesAction(): Promise<SizesResult> {
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  return (await removeMySizes(s.db, s.userId)) ? refresh() : { ok: false, error: "That didn't work. Try again." };
}
