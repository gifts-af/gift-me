import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PersonView } from "./person-view";

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
