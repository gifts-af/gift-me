import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PersonView } from "./person-view";

// For the Server Actions on this page: saving an address places that person's gifts held for one.
// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

// One person: their details, occasions, budgets and list link. Signed-out
// visitors are sent to sign in by proxy.ts.
export default function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string; address?: string }>;
}) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <BackLink href="/" label="People" />
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
  searchParams: Promise<{ photo?: string; address?: string }>;
}) {
  const [{ id }, { photo, address }] = await Promise.all([params, searchParams]);
  return <PersonView id={id} photoFailed={photo === "failed"} openAddress={address === "open"} />;
}
