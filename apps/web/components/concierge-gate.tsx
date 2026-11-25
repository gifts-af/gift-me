import { redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConciergePitch } from "@/components/home/concierge-pitch";
import { errorFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { getAccessState } from "@/modules/concierge";

/** The signed-in person's access, or null when the check failed. Signed out goes to sign in. */
export async function readAccess(): Promise<Awaited<ReturnType<typeof getAccessState>> | null> {
  let userId: string | null = null;
  let state: Awaited<ReturnType<typeof getAccessState>> | null = null;
  try {
    const supabase = (await createClient()) as unknown as SupabaseClient<Database>;
    // No session comes back as no data and no error: that's a redirect. An
    // error means the check failed, which must not look like signed out.
    const { data, error } = await supabase.auth.getClaims();
    if (error) throw error;
    userId = data?.claims?.sub ?? null;
    if (userId) state = await getAccessState(supabase, userId);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("concierge_access.check_failed", { user_id: userId, ...errorFields(error) });
    return null;
  }
  if (!state) redirect("/auth/login");
  return state;
}

/** Shown when the access check fails: never the concierge, and never the pitch. */
export function AccessCheckFailed() {
  return (
    <p role="alert" className="text-[15px] text-muted-foreground">
      We couldn&apos;t load this. Refresh to try again.
    </p>
  );
}

/**
 * Shows a concierge page to someone with access, and the pitch to anyone else.
 * Put everything the page shows inside, title included, and the gate inside a
 * Suspense. Server components passed as children don't run unless the gate
 * returns them. It goes in pages, not layouts, which don't run again when you
 * move between their pages. `frame` wraps what shows instead of the page, for
 * a page that brings its own top bar and frame.
 */
export async function ConciergeGate({
  children,
  frame = (notice) => notice,
}: {
  children: ReactNode;
  frame?: (notice: ReactNode) => ReactNode;
}) {
  const state = await readAccess();
  if (!state) return frame(<AccessCheckFailed />);
  return state.access ? children : frame(<ConciergePitch requested={state.requested} />);
}
