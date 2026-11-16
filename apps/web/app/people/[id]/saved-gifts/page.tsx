import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { todayForRequest } from "@/lib/today";
import { getPerson, listSavedGifts } from "@/modules/concierge";
import { storeName } from "@/modules/lists";
import { readGiftLinkAction, removeSavedGiftAction, saveGiftAction } from "../../actions";
import { SavedGifts } from "../saved-gifts";

// A person's Saved gifts screen (ALL-93, moved here in ALL-127), opened from
// its row on their page. Signed-out visitors are sent to sign in by proxy.ts.
export default function SavedGiftsPage({ params }: { params: Promise<{ id: string }> }) {
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
  const gifts = await listSavedGifts(person.id);

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>Saved gifts for {person.name}</PageTitle>
      <SavedGifts
        personId={person.id}
        name={person.name}
        gifts={gifts.map((g) => ({ ...g, store: g.productUrl ? storeName(g.productUrl) : null }))}
        readAction={readGiftLinkAction}
        saveAction={saveGiftAction}
        removeAction={removeSavedGiftAction}
      />
    </>
  );
}
