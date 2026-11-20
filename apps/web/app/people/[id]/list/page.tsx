import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { appSettingInt } from "@/lib/app-settings";
import { todayForRequest } from "@/lib/today";
import { getPerson } from "@/modules/concierge";
import { getPersonShareToken } from "@/modules/lists";
import { linkListAction, unlinkListAction } from "../../actions";
import { ListLink } from "../list-link";

// A person's Their list screen (ALL-21, moved here in ALL-127). Their list is
// the share page now (ALL-123): a linked person goes there, and one without a
// list goes back to their page. With the card switched off
// (list_link_card_enabled = 0) the old link form shows instead.
// Signed-out visitors are sent to sign in by proxy.ts.
export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  // The whole page is inside Suspense so the redirect happens before any frame
  // is sent.
  return (
    <Suspense fallback={null}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();

  const token = await getPersonShareToken(person.id);
  if (token) redirect(`/share/${token}`);
  if ((await appSettingInt("list_link_card_enabled")) === 1) redirect(`/people/${person.id}`);

  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <BackLink href={`/people/${person.id}`} label={person.name} />
        <PageTitle>{person.name}&apos;s list</PageTitle>
        <ListLink variant="page" name={person.name} personId={person.id} keepsList={person.keepsList} linkAction={linkListAction} unlinkAction={unlinkListAction} />
      </PageFrame>
    </>
  );
}
