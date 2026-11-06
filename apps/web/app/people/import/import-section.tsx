import { unstable_rethrow } from "next/navigation";
import { logEvent } from "@/lib/log";
import { listImportedContactIds } from "@/modules/concierge";
import { importContactsAction } from "../actions";
import { ImportFromGoogle } from "./import-from-google";

// The checklist, loaded on its own so the page's frame shows first.
export async function ImportSection() {
  // The OAuth client Supabase's Google sign-in uses; public, set per environment.
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return (
      <p role="alert" className="text-[15px] text-destructive">
        Google import isn&apos;t set up here (NEXT_PUBLIC_GOOGLE_CLIENT_ID).
      </p>
    );
  }
  let imported: string[];
  try {
    imported = await listImportedContactIds();
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    logEvent("imported_contacts_load_failed", { error: error instanceof Error ? error.name : "unknown" });
    return <p className="text-[15px] text-muted-foreground">We couldn&apos;t load your people. Refresh to try again.</p>;
  }
  return <ImportFromGoogle clientId={clientId} imported={imported} action={importContactsAction} />;
}
