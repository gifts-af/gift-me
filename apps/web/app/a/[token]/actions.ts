"use server";

import { createClient } from "@/lib/supabase/server";
import { confirmActionLink, createSupabaseNotifyStore, type ConfirmResult } from "@/modules/concierge";

// The confirm button's POST: the only place an action link is used up and its
// action run (ALL-23, AC-3, AC-4). confirmActionLink re-checks everything, so a
// re-post (double tap, back button) gets "used", not a second run (AC-5).
// The form's previous state and fields are ignored: the token is all it needs.
export async function confirmLink(token: string): Promise<ConfirmResult> {
  const supabase = await createClient();
  const viewerId = (await supabase.auth.getClaims()).data?.claims?.sub ?? null;
  return confirmActionLink(token, viewerId, { store: createSupabaseNotifyStore(), now: new Date() });
}
