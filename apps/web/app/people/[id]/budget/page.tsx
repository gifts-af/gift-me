import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ConciergeGate } from "@/components/concierge-gate";
import { todayForRequest } from "@/lib/today";
import { getPerson } from "@/modules/concierge";
import { saveBudgetsAction } from "../../actions";
import { BudgetForm } from "./budget-form";

// A person's Budget screen (ALL-120, T71), opened from the Budget row on their
// page. Signed-out visitors are sent to sign in by proxy.ts.
export default function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <ConciergeGate>
            <Loaded params={params} />
          </ConciergeGate>
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
      <PageTitle>Budget for {person.name}</PageTitle>
      <BudgetForm
        // The fields start from the saved amounts; a new key rebuilds them when
        // those change, since the app can keep this screen between visits.
        key={JSON.stringify([person.baseBudgetCents, person.occasions.map((o) => [o.kind, o.budgetCents])])}
        personId={person.id}
        name={person.name}
        baseCents={person.baseBudgetCents}
        defaultCents={person.defaultBudgetCents}
        occasions={person.occasions.filter((o) => o.enabled)}
        action={saveBudgetsAction}
      />
    </>
  );
}
