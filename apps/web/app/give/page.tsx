import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { GiftsSection } from "@/components/home/gifts-section";
import { HomeScreenTip } from "@/components/home/home-screen-tip";
import { PeopleSection } from "@/components/home/people-section";
import { RequestAccessCard } from "@/components/home/request-access-card";
import { YouCard } from "@/components/home/you-card";
import { getMyListSummary } from "@/modules/lists";

// Give: the people you buy for (T58). You come first, with the
// way to your own list. The card and the people load separately, so a slow or
// failing concierge can't hold up the list (T19). People are free; without the
// concierge, the way to ask for it comes after them. Signed-out visitors are
// sent to sign in by proxy.ts.
export default function GivePage() {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame wide>
        <Suspense fallback={null}>
          <HomeScreenTip />
        </Suspense>
        {/* On its own, so slow or failing gifts never hold up the people. */}
        <Suspense fallback={null}>
          <GiftsSection />
        </Suspense>
        <section aria-labelledby="people-heading" className="flex flex-col gap-3">
          <PageTitle id="people-heading">People</PageTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Suspense fallback={<YouCard />}>
              <YourCard />
            </Suspense>
            <Suspense fallback={<p className="col-span-full text-[15px] text-muted-foreground">Loading…</p>}>
              <PeopleSection />
            </Suspense>
          </div>
        </section>
        <Suspense fallback={null}>
          <RequestAccessCard />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function YourCard() {
  const summary = await getMyListSummary();
  return <YouCard count={summary ? summary.count : null} />;
}
