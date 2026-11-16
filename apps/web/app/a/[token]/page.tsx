import type { Metadata } from "next";
import { Suspense } from "react";
import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseNotifyStore, readActionLink } from "@/modules/concierge";
import { ActionLinkView } from "./link-view";

// A one-time email action link (ALL-23). Kept out of search results, and no
// Referer header, so the token in the address doesn't leak to other sites.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// For the confirm Server Action: file_note reads the note with the model (ALL-31), like
// /api/captures/[id]/extract. Next needs a literal here.
export const maxDuration = 60;

// Params and the session cookie are runtime data, so this renders inside
// <Suspense> under cacheComponents. A GET only reads: nothing is used up and
// no action runs until the confirm button posts (AC-3).
async function Loader({ params }: PageProps<"/a/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const viewerId = (await supabase.auth.getClaims()).data?.claims?.sub ?? null;
  const view = await readActionLink(token, viewerId, { store: createSupabaseNotifyStore(), now: new Date() });
  return <ActionLinkView view={view} token={token} />;
}

export default function ActionLinkPage(props: PageProps<"/a/[token]">) {
  return (
    <Suspense>
      <Loader {...props} />
    </Suspense>
  );
}
