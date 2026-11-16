import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { todayForRequest } from "@/lib/today";
import { getPerson } from "@/modules/concierge";
import { linkListAction, unlinkListAction } from "../../actions";
import { ListLink } from "../list-link";

// A person's Their list screen (ALL-21, moved here in ALL-127): link or unlink
// their GiftsAF list. Signed-out visitors are sent to sign in by proxy.ts.
export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>{person.name}&apos;s list</PageTitle>
      <ListLink personId={person.id} keepsList={person.keepsList} linkAction={linkListAction} unlinkAction={unlinkListAction} />
    </>
  );
}
