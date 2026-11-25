import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ConciergeGate } from "@/components/concierge-gate";
import { getConciergeSettings } from "@/modules/concierge";
import { saveOverBudget } from "../actions";
import { OverBudgetField } from "../over-budget-field";

async function LoadedField() {
  const { overBudgetPct } = await getConciergeSettings();
  return <OverBudgetField initial={overBudgetPct} action={saveOverBudget} />;
}

export default function OverBudgetPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <ConciergeGate>
            <BackLink href="/settings" label="Settings" />
            <PageTitle>Over-budget allowance</PageTitle>
            <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
              <LoadedField />
            </Suspense>
          </ConciergeGate>
        </Suspense>
      </PageFrame>
    </>
  );
}
