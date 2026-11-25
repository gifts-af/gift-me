"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  buildAccessConfirmation,
  buildAccessRequest,
  claimAccessRequest,
  defaultChannels,
  releaseAccessRequest,
  requestConciergeAccess,
} from "@/modules/concierge";

/** Asks for the concierge for whoever is signed in. It takes nothing from the browser. */
export async function requestAccessAction(): Promise<{ status: "sent" | "busy" | "error" }> {
  let userId: string | null = null;
  try {
    const supabase = (await createClient()) as unknown as SupabaseClient<Database>;
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError) throw authError;
    userId = auth?.claims?.sub ?? null;
    if (!userId) return { status: "error" };
    const { data: profile, error } = await supabase.from("profiles").select("display_name, email").eq("id", userId).single();
    if (error) throw error;
    if (!profile.email) throw new Error("This account has no email");

    const db = createAdminClient();
    const [email] = defaultChannels(process.env);
    const result = await requestConciergeAccess(
      { id: userId, email: profile.email, name: profile.display_name },
      {
        claim: (id) => claimAccessRequest(db, id),
        release: (id) => releaseAccessRequest(db, id),
        sendOwner: (user) => email.send(buildAccessRequest(user)),
        sendPerson: (user) => email.send(buildAccessConfirmation(user)),
        log: logEvent,
      },
    );
    // Give and the gated pages can all show the button, so whichever it was is re-read.
    if (result.status === "sent") refresh();
    return result;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("concierge_access.request_failed", { user_id: userId, ...errorFields(error) });
    return { status: "error" };
  }
}
