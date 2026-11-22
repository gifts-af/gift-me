import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { roundReturnPath } from "@/lib/safe-next";
import { todayForRequest } from "@/lib/today";
import { getPerson } from "@/modules/concierge";
import { removeAddressAction, saveAddressAction } from "../../actions";
import { AddressSection } from "../address";

// For the Server Actions on this page: saving an address places that person's gifts held for one.
// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

// A person's Shipping address screen (ALL-81, moved here in ALL-127), opened
// from its row on their page. `?open=1` opens the form, for the "Add an
// address" email. Signed-out visitors are sent to sign in by proxy.ts.
export default function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ open?: string; next?: string }>;
}) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <Loaded params={params} searchParams={searchParams} />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Loaded({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ open?: string; next?: string }>;
}) {
  const [{ id }, { open, next }] = await Promise.all([params, searchParams]);
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>Shipping address for {person.name}</PageTitle>
      <AddressSection
        personId={person.id}
        name={person.name}
        address={person.address}
        startOpen={open === "1"}
        next={roundReturnPath(next)}
        saveAction={saveAddressAction}
        removeAction={removeAddressAction}
      />
    </>
  );
}
