import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { APP_NAME } from "@/lib/brand";
import { todayForRequest } from "@/lib/today";
import { getPerson, listPeople } from "@/modules/concierge";
import { SharedList, getSharedList, getSharePreview, type SharedListData } from "@/modules/lists";
import { addFromShareAction, linkFromShareAction, unlinkFromShareAction } from "./actions";
import { ListCard } from "./list-card";

// A share link is private to whoever has it: keep it out of search (ALL-123).
const ROBOTS = { index: false, follow: false } as const;

// The chat preview names the owner and nothing else (ALL-123). Unknown or
// reset link, no name, or the setting off: the generic title (the image does
// the same). Read per request, so a reset link stops showing the name.
export async function generateMetadata({ params }: PageProps<"/share/[token]">): Promise<Metadata> {
  await connection();
  const { token } = await params;
  const preview = await getSharePreview(token);
  if (!preview?.ownerName) return { title: APP_NAME, robots: ROBOTS };
  const title = `${preview.ownerName}'s wish list on ${APP_NAME}`;
  return { title, openGraph: { title, siteName: APP_NAME, type: "website" }, twitter: { title }, robots: ROBOTS };
}

// The card above the list (ALL-123): nothing for the owner or when the
// setting is off (AC-25, E7). Otherwise sign in, add or link, or remove.
async function Card({ list, token }: { list: SharedListData; token: string }) {
  if (list.isOwner || !list.cardEnabled) return null;
  const actions = { linkAction: linkFromShareAction, unlinkAction: unlinkFromShareAction };
  const base = { token, displayName: list.ownerName, ...actions };
  if (!list.viewer.signedIn) return <ListCard state="signed-out" candidates={[]} linked={null} {...base} />;

  const today = await todayForRequest();
  if (list.linkedPerson) {
    const person = await getPerson(list.linkedPerson.id, today);
    const linked = { ...list.linkedPerson, sharedAddress: person?.address.kind === "shared" };
    return <ListCard state="linked" candidates={[]} linked={linked} {...base} />;
  }
  // Only people with no list linked: the picker never replaces a link (AC-20).
  const candidates = (await listPeople(today)).filter((p) => !p.keepsList).map(({ id, name }) => ({ id, name }));
  return <ListCard state="add" candidates={candidates} linked={null} {...base} />;
}

// Params and the session cookie are runtime data, so the loader has to
// render inside <Suspense> under cacheComponents. Works signed out.
async function SharedListLoader({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const list = await getSharedList(token);
  if (!list) notFound();
  // The owner sees their list without claims (product decision 39): the
  // database leaves them out, so there's nothing to spoil and no gate.
  return (
    <SharedList
      list={list}
      token={token}
      nav={list.viewer.signedIn ? <AppNav /> : undefined}
      top={<Card list={list} token={token} />}
      addToMine={addFromShareAction}
    />
  );
}

export default function SharePage(props: PageProps<"/share/[token]">) {
  return (
    <Suspense
      fallback={
        <>
          <TopBar />
          <PageFrame wide>
            <p className="text-[15px] text-muted-foreground" aria-busy="true">
              Loading…
            </p>
          </PageFrame>
        </>
      }
    >
      <SharedListLoader {...props} />
    </Suspense>
  );
}
