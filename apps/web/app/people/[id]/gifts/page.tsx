import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reactionsEnabled } from "@/app/rounds/reactions-open";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ConciergeGate } from "@/components/concierge-gate";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, giftHistory } from "@/modules/concierge";
import { PastGifts } from "./past-gifts";

// A person's past gifts, opened from its row on their page. Signed-out visitors are sent to sign
// in by proxy.ts.
export default function PastGiftsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <ConciergeGate>
            <Loaded params={params} />
          </ConciergeGate>
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const now = new Date();
  const supabase = (await createClient()) as unknown as SupabaseClient<Database>;
  const [rounds, canAnswer] = await Promise.all([giftHistory(person.id, supabase, now), reactionsEnabled(supabase)]);

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>Past gifts for {person.name}</PageTitle>
      <PastGifts name={person.name} rounds={rounds} today={now.toISOString().slice(0, 10)} canAnswer={canAnswer} />
    </>
  );
}
