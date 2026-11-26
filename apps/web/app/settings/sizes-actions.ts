"use server";

import { revalidatePath } from "next/cache";
import { parseOneSize, parseSizesForm, removeMySizes, saveMySizes, saveOneSize, sizesSharingOn, type SizesDb } from "@/lib/account-sizes";
import { appSettingInt } from "@/lib/app-settings";
import { SIZE_KINDS, type SizeKind } from "@/lib/size-kinds";
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

// The kinds My list may ask for: every size, never favorite color (ALL-184).
const ASKABLE = new Set<string>(SIZE_KINDS.map(({ kind }) => kind).filter((kind) => kind !== "color"));

export type OneSizeResult = { ok: true } | { ok: false; error: string };

/** One size typed into My list's card, saved and shared. The kind comes from the browser, so it's checked. */
export async function saveOneSizeAction(kind: SizeKind, value: string): Promise<OneSizeResult> {
  if (typeof kind !== "string" || !ASKABLE.has(kind) || typeof value !== "string") {
    return { ok: false, error: "That didn't save. Try again." };
  }
  const parsed = parseOneSize(value);
  if (!parsed.ok) return parsed;
  const s = await session();
  if (!s) return SIGN_IN_AGAIN;
  if (!(await sizesSharingOn(appSettingInt))) return { ok: false, error: "This is switched off right now." };
  if (!(await saveOneSize(s.db, s.userId, kind, parsed.value))) return { ok: false, error: "That didn't save. Try again." };
  refresh();
  return { ok: true };
}
