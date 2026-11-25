import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ConciergeGate } from "@/components/concierge-gate";
import { PayingForGiftsSection } from "../paying-for-gifts-section";

// For the Server Actions on this page: finishing Zinc setup or saving the phone places held gifts.
// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

export default function PayingPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <ConciergeGate>
            <BackLink href="/settings" label="Settings" />
            <PageTitle>Paying for gifts</PageTitle>
            <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading your settings…</p>}>
              <PayingForGiftsSection />
            </Suspense>
          </ConciergeGate>
        </Suspense>
      </PageFrame>
    </>
  );
}
