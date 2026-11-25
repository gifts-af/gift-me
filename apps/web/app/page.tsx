import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { SendHome } from "@/components/home/send-home";

// Signed in, / sends you home: Give with concierge access, My list without.
// proxy.ts shows signed-out visitors the public home page here instead.
export default function Home() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <SendHome />
        </Suspense>
      </PageFrame>
    </>
  );
}
