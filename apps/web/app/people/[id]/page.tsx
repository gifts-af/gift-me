import { Suspense } from "react";
import { Account } from "@/components/app-shell/account";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PersonView } from "./person-view";

// One person: their details, occasions, budgets and list link. Signed-out
// visitors are sent to sign in by proxy.ts.
export default function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string }>;
}) {
  return (
    <>
      <TopBar back={{ href: "/", label: "Home" }} account={<Account />} />
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
  searchParams: Promise<{ photo?: string }>;
}) {
  const [{ id }, { photo }] = await Promise.all([params, searchParams]);
  return <PersonView id={id} photoFailed={photo === "failed"} />;
}
