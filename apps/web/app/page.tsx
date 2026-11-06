import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { HomeScreenTip } from "@/components/home/home-screen-tip";
import { PeopleSection } from "@/components/home/people-section";
import { YouCard } from "@/components/home/you-card";
import { getMyListSummary } from "@/modules/lists";

// Give: the page after sign-in, and the people you buy for (ALL-95, revising
// T29). You come first, with the way to your own list. The card and the people
// load separately, so a slow or failing concierge can't hold up the list (T19).
// proxy.ts sends signed-out visitors to the public home page.
export default function Home() {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame wide>
        <Suspense fallback={null}>
          <HomeScreenTip />
        </Suspense>
        <section aria-labelledby="people-heading" className="flex flex-col gap-3">
          <PageTitle id="people-heading">People</PageTitle>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Suspense fallback={<YouCard />}>
              <YourCard />
            </Suspense>
            <Suspense fallback={<p className="col-span-full text-[15px] text-muted-foreground">Loading…</p>}>
              <PeopleSection />
            </Suspense>
          </div>
        </section>
      </PageFrame>
    </>
  );
}

async function YourCard() {
  const summary = await getMyListSummary();
  return <YouCard count={summary ? summary.count : null} />;
}
