"use server";

import { redirect } from "next/navigation";
import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  captureStoreFor,
  confirmActionLink,
  createSupabaseInboundStore,
  createSupabaseNotifyStore,
  defaultChannels,
  type ConfirmResult,
} from "@/modules/concierge";

// The confirm button's POST: the only place an action link is used up and its
// action run (ALL-23, AC-3, AC-4). confirmActionLink re-checks everything, so a
// re-post (double tap, back button) gets "used", not a second run (AC-5).
// The form's previous state and fields are ignored: the token is all it needs.
export async function confirmLink(token: string): Promise<ConfirmResult> {
  const supabase = await createClient();
  const viewerId = (await supabase.auth.getClaims()).data?.claims?.sub ?? null;
  const db = createAdminClient();
  const store = createSupabaseNotifyStore(db);
  const now = new Date();
  // file_note (ALL-31) files an emailed note, reads it and may email back, under the inbound
  // daily cap, like the webhook route. Built only when a file_note link runs.
  const notes = () => ({
    captureStore: (userId: string) => captureStoreFor(db, userId),
    extract: createExtractor(AI_MODELS.extraction),
    inbound: createSupabaseInboundStore(db),
    notify: { store, channels: defaultChannels(), baseUrl: siteUrl(), now },
  });
  const result = await confirmActionLink(token, viewerId, { store, now, notes });
  if (result.state === "done" && result.straight && result.next) redirect(result.next);
  return result;
}
