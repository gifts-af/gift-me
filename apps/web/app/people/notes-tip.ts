import "server-only";
import { after } from "next/server";
import { errorFields, logEvent } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createSupabaseInboundStore,
  createSupabaseNotifyStore,
  defaultChannels,
  sendNotesTipOnce,
} from "@/modules/concierge";

/**
 * After a person is added, sends the one-time notes tip (ALL-31 AC-15) once the response is
 * done. Only the first person ever added sends it; sendNotesTipOnce decides. Never throws.
 */
export async function scheduleNotesTip(person: { id: string; name: string }): Promise<void> {
  try {
    const notesAddress = process.env.INBOUND_NOTES_ADDRESS;
    if (!notesAddress) {
      logEvent("inbound.misconfigured", {});
      return;
    }
    const { data } = await (await createClient()).auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) return;
    after(async () => {
      try {
        const db = createAdminClient();
        await sendNotesTipOnce(userId, person, {
          store: createSupabaseInboundStore(db),
          notify: { store: createSupabaseNotifyStore(db), channels: defaultChannels(process.env), baseUrl: siteUrl(), now: new Date() },
          notesAddress,
        });
      } catch (e) {
        logEvent("inbound.tip_failed", { user_id: userId, person_id: person.id, ...errorFields(e) });
      }
    });
  } catch (e) {
    logEvent("inbound.tip_failed", { person_id: person.id, ...errorFields(e) });
  }
}
