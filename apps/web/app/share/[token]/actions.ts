"use server";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { linkUnlinkedPerson, unlinkPerson, UUID_PATTERN } from "@/modules/lists";

// The card on a shared list (ALL-123). The lists module does the work and logs
// its own failures; these log only the successes (E6: ids only).

type Result = { ok: true } | { ok: false; error: string };

async function userId(): Promise<string | null> {
  return (await (await createClient()).auth.getClaims()).data?.claims?.sub ?? null;
}

// Both ids are checked before any work, so a forged call can't make the server
// revalidate an arbitrary path (E4).
function validIds(token: unknown, personId: unknown): boolean {
  return typeof token === "string" && typeof personId === "string" && UUID_PATTERN.test(token) && UUID_PATTERN.test(personId);
}

function refresh(token: string, personId: string) {
  revalidatePath(`/share/${token}`);
  revalidatePath(`/people/${personId}`);
}

/** Link one of the buyer's people, who has no list yet, to this list. Never replaces a link. */
export async function linkFromShareAction(token: string, personId: string): Promise<Result> {
  if (!validIds(token, personId)) return { ok: false, error: "That didn't save. Try again." };
  const result = await linkUnlinkedPerson(token, personId);
  if (!result.ok) return { ok: false, error: result.error };
  logEvent("lists.linked_from_share", { user_id: await userId(), person_id: personId, list_id: result.listId });
  refresh(token, personId);
  return { ok: true };
}

/**
 * Remove the buyer's person's list link. The person, occasions and budgets stay.
 * The token is used only to refresh this page: unlink_person acts on the
 * caller's own person whatever list it's linked to, which is harmless.
 */
export async function unlinkFromShareAction(token: string, personId: string): Promise<Result> {
  if (!validIds(token, personId)) return { ok: false, error: "That didn't save. Try again." };
  const result = await unlinkPerson(personId);
  if (!result.ok) return result;
  logEvent("lists.unlinked_from_share", { user_id: await userId(), person_id: personId });
  refresh(token, personId);
  return { ok: true };
}
