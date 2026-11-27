import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PersonGifts } from "./person-gifts";
import { PersonView } from "./person-view";

// One person: rows that open their own screens (ALL-127), What we know among them. Its
// "Read them now", which can run long, is on that screen (know/page.tsx keeps the 300 s).
// Signed-out visitors are sent to sign in by proxy.ts.
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
        <BackLink href="/give" label="People" />
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
  // "Add an address" emails already sent link here (ALL-81): the form is on its own screen now.
  if (address === "open") redirect(`/people/${encodeURIComponent(id)}/address?open=1`);
  return (
    <PersonView
      id={id}
      photoFailed={photo === "failed"}
      gifts={
        <Suspense fallback={null}>
          <PersonGifts personId={id} />
        </Suspense>
      }
    />
  );
}
