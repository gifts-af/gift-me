import "server-only";
import { notFound } from "next/navigation";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyAddress } from "@/lib/account-address";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, roundAccess, roundView, type RoundPageView } from "@/modules/concierge";
import { roundDbDeps } from "@/app/settings/zinc-deps";
import type { Place, RecipientAddress } from "./ship-to";

// What the confirm and fix pages read on load (ALL-29). Only reads (AC-4a). Whose round it is
// comes from the service role and nothing more (AC-3); everything shown is read as the user,
// so RLS applies (T26).

export type Loaded = { kind: "other" } | { kind: "mine"; userId: string; view: RoundPageView };

export async function loadRound(id: string): Promise<Loaded> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) notFound();
  const access = await roundAccess(id, userId, roundDbDeps(new Date()));
  if (access === "missing") notFound();
  if (access === "other") return { kind: "other" };
  const view = await roundView(id, supabase as unknown as SupabaseClient<Database>, new Date());
  if (!view) notFound();
  return { kind: "mine", userId, view };
}

/**
 * The "Where it goes" choices: the person's address (a list owner's shared one shows only city
 * and state, decision 38; one saved here counts only when it's complete) and the buyer's own.
 */
export async function shipToChoices(personId: string, userId: string): Promise<{ recipient: RecipientAddress; buyerAddress: Place | null }> {
  const supabase = await createClient();
  const [person, mine] = await Promise.all([getPerson(personId, await todayForRequest()), getMyAddress(supabase, userId)]);
  const a = person?.address;
  let recipient: RecipientAddress = { kind: "none" };
  if (a?.kind === "shared") recipient = { kind: "shared", city: a.city, state: a.state };
  else if (a?.kind === "own" && Object.keys(a.problems).length === 0) recipient = { kind: "own", city: a.address.city ?? "", state: a.address.state ?? "" };
  return { recipient, buyerAddress: mine.kind === "saved" ? { city: mine.address.city, state: mine.address.state } : null };
}
