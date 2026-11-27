import type { Metadata } from "next";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { APP_NAME } from "@/lib/brand";
import { GiftsList } from "./gifts-list";

// Every gift in progress, opened from its summary row on Give. Signed-out visitors are sent to
// sign in by proxy.ts.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
};

export default function GiftsPage() {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <BackLink href="/give" label="Give" />
        <PageTitle>Gifts in progress</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <GiftsList />
        </Suspense>
      </PageFrame>
    </>
  );
}
