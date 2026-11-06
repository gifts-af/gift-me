import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { ImportSection } from "./import-section";

// Import people from Google Contacts (ALL-24). Signed-out visitors are sent
// to sign in by proxy.ts.
export default function ImportPage() {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <PageTitle>Who do you buy gifts for?</PageTitle>
        <Suspense fallback={null}>
          <ImportSection />
        </Suspense>
      </PageFrame>
    </>
  );
}
