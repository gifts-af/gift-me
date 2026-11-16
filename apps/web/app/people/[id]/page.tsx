import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { PersonView } from "./person-view";

// For the Server Actions on this page: "Read them now" (readCapturesAction) reads unread
// captures with AI one after another, which can run long. 300 s is the most Vercel's Fluid
// compute allows on our plan (review of ALL-127). Next needs a literal here.
export const maxDuration = 300;

// One person: what we know, then rows that open their own screens (ALL-127).
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
  // "Add an address" emails already sent link here (ALL-81): the form is on its own screen now.
  if (address === "open") redirect(`/people/${encodeURIComponent(id)}/address?open=1`);
  return <PersonView id={id} photoFailed={photo === "failed"} />;
}
