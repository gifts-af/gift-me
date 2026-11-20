import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, ideaRunOffer, onDemandIdeas, savedProductIds, type Db } from "@/modules/concierge";
import { saveIdeaAction, suggestIdeasAction } from "../../actions";
import { IdeasScreen } from "./ideas-screen";

// A person's Gift ideas screen (ALL-27), opened from its row on their page. A run can
// take up to two AI and two Zinc timeouts, so the page's actions get 300 s.
// Signed-out visitors are sent to sign in by proxy.ts.
export const maxDuration = 300;

export default function IdeasPage({ params }: { params: Promise<{ id: string }> }) {
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
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const db = (await createClient()) as unknown as Db;
  const [ideas, offer, saved] = await Promise.all([onDemandIdeas(db, person.id), ideaRunOffer(db), savedProductIds(person.id)]);

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>Gift ideas for {person.name}</PageTitle>
      <IdeasScreen
        personId={person.id}
        personName={person.name}
        offer={offer}
        ideas={ideas}
        action={suggestIdeasAction}
        savedProductIds={saved}
        saveAction={saveIdeaAction}
      />
    </>
  );
}
