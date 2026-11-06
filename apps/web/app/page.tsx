import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { InstallTip } from "@/components/app-shell/install-tip";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PeopleSection } from "@/components/home/people-section";
import { YouCard } from "@/components/home/you-card";
import { appSettingInt } from "@/lib/app-settings";
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

// Phones only, and only outside the installed app (ALL-57). A tip never
// breaks Home: if its setting can't be read, it just isn't shown.
async function HomeScreenTip() {
  try {
    return <InstallTip snoozeDays={await appSettingInt("install_tip_snooze_days")} />;
  } catch (error) {
    console.error("install tip hidden", error);
    return null;
  }
}

async function YourCard() {
  const summary = await getMyListSummary();
  return <YouCard count={summary ? summary.count : null} />;
}
