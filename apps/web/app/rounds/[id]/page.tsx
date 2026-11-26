import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { roundAccess, roundView } from "@/modules/concierge";
import { roundDbDeps, settingInt, zincWiring } from "@/lib/wiring";
import { holdGateFor } from "@/lib/hold-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { markArrived, rejectAction, rejectionOutlookAction, setBudgetAction } from "../actions";
import { OtherAccount } from "../access";
import { reactionsOpen } from "../reactions-open";
import { RoundScreen } from "./round-screen";

// The round screen (ALL-29), from the round emails' button or a person's page. Loading only
// reads (AC-4a): picking goes on to the confirm page, and rejecting or saving a budget happen in
// the server actions. Signed-out visitors are sent to sign in by proxy.ts, which brings them back
// here with the path and query (AC-3). No referrer, so stores never see a round's address.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <Loaded params={params} />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) notFound();
  // The only service-role read: whose round it is, and nothing more (AC-3).
  const access = await roundAccess(id, userId, roundDbDeps(new Date()));
  if (access === "missing") notFound();
  if (access === "other") return <OtherAccount />;

  // Everything shown is read as the user, so RLS applies (T26).
  const view = await roundView(id, supabase as unknown as SupabaseClient<Database>, new Date(), holdGateFor(supabase, userId));
  if (!view) notFound();
  const name = view.round.personName;
  // "Mark as arrived" shows only while order tracking is on (E7); markArrived checks again.
  const tracking = (await settingInt(createAdminClient(), "order_tracking_enabled")) === 1;

  // The same page the emails send a short balance to; Paying for gifts where Zinc is off or unreadable.
  const zinc = view.hold?.kind === "funds" ? await zincWiring(createAdminClient()).catch(() => null) : null;

  return (
    <>
      {name && <BackLink href={`/people/${view.round.personId}`} label={name} />}
      <PageTitle>{name ? `Gift for ${name}` : "Gift"}</PageTitle>
      <RoundScreen
        view={view}
        walletUrl={zinc?.walletUrl}
        rejectAction={rejectAction}
        setBudgetAction={setBudgetAction}
        outlookAction={rejectionOutlookAction}
        arrivedAction={tracking ? markArrived : null}
        reactionsOpen={await reactionsOpen(supabase, view.round.occasionDate, new Date())}
      />
    </>
  );
}
