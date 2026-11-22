import { logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "./lists";

// Plain functions, not server actions: the share page's actions call them and
// log the product events (ALL-123).

const NO_LONGER_WORKS = "This list link no longer works. Ask them for a new one.";
const TRY_AGAIN = "That didn't save. Try again.";

type LinkResult = { ok: true; listId: string } | { ok: false; error: string; personId?: string };

// The person's name for the error copy, read from the caller's own row (RLS
// keeps it to theirs). Falls back to a plain word if it can't be read.
async function personName(personId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("people").select("name").eq("id", personId).maybeSingle();
  return data?.name ?? "This person";
}

/**
 * Link the caller's person to the list behind a share link, only when
 * neither side is linked already. Never replaces a link.
 */
export async function linkUnlinkedPerson(token: string, personId: string): Promise<LinkResult> {
  // A malformed id would fail Postgres's uuid cast; treat it as a dead link.
  if (!UUID_PATTERN.test(token) || !UUID_PATTERN.test(personId)) return { ok: false, error: NO_LONGER_WORKS };

  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("lists")
    .rpc("link_unlinked_person", { p_token: token, p_person_id: personId });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: NO_LONGER_WORKS };
    if (error.code === "22023") return { ok: false, error: "You can't link your own list." };
    // 40P01: a deadlock with a token reset; nothing was saved.
    if (error.code !== "40P01") logEvent("person_link_failed", { person_id: personId, code: error.code ?? null });
    return { ok: false, error: TRY_AGAIN };
  }

  const result = data as { status: string; list_id?: string; person_id?: string } | null;
  if (result?.status === "linked" && result.list_id) return { ok: true, listId: result.list_id };
  if (result?.status === "person_has_list") {
    return { ok: false, error: `${await personName(personId)} already has a list linked.` };
  }
  if (result?.status === "list_has_person" && result.person_id) {
    return {
      ok: false,
      error: `This list is already linked to ${await personName(result.person_id)}.`,
      personId: result.person_id,
    };
  }
  logEvent("person_link_failed", { person_id: personId, code: "unexpected_status" });
  return { ok: false, error: TRY_AGAIN };
}

/** Remove a person's list link. The person and their occasions stay. */
export async function unlinkPerson(personId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_PATTERN.test(personId)) return { ok: false, error: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.schema("lists").rpc("unlink_person", { p_person_id: personId });
  if (error) {
    logEvent("person_unlink_failed", { person_id: personId, code: error.code ?? null });
    return { ok: false, error: TRY_AGAIN };
  }
  return { ok: true };
}
