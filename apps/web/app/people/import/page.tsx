import { Suspense } from "react";
import { Account } from "@/components/app-shell/account";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { listImportedContactIds } from "@/modules/concierge";
import { importContactsAction } from "../actions";
import { ImportFromGoogle } from "./import-from-google";

// Import people from Google Contacts (ALL-24). Signed-out visitors are sent
// to sign in by proxy.ts.
export default function ImportPage() {
  return (
    <>
      <TopBar links current="people" account={<Account />} />
      <PageFrame>
        <PageTitle>Who do you buy gifts for?</PageTitle>
        <Suspense fallback={null}>
          <Checklist />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Checklist() {
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
    console.error("imported contacts not loaded", error);
    return <p className="text-[15px] text-muted-foreground">We couldn&apos;t load your people. Refresh to try again.</p>;
  }
  return <ImportFromGoogle clientId={clientId} imported={imported} action={importContactsAction} />;
}
