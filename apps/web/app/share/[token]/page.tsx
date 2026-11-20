import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { SharedList, getSharedList } from "@/modules/lists";

// A share link is private to whoever has it: keep it out of search (ALL-123).
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Params and the session cookie are runtime data, so the loader has to
// render inside <Suspense> under cacheComponents. Works signed out.
async function SharedListLoader({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const list = await getSharedList(token);
  if (!list) notFound();
  // The owner sees their list without claims (product decision 39): the
  // database leaves them out, so there's nothing to spoil and no gate.
  return <SharedList list={list} token={token} nav={list.viewer.signedIn ? <AppNav /> : undefined} />;
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
