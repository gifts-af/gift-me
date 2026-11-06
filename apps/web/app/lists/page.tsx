import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { TopBar } from "@/components/app-shell/top-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import { GiftApp, GiftAppSkeleton, getMyList } from "@/modules/lists";

// Reads the session cookie, so it has to render inside <Suspense> under
// cacheComponents. Works signed in or out; a guest's list isn't saved.
async function ListLoader() {
  const initial = await getMyList();
  return <GiftApp initial={initial} />;
}

// This page works signed out, so what fills the bar waits for the session.
// Until then the logo shows alone; the row keeps its height (ALL-95).
async function ListsBarEnd() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return <AppNav current="get" />;
  return (
    <div className="ml-auto">
      <ThemeToggle />
    </div>
  );
}

export default function ListsPage() {
  return (
    <>
      <TopBar>
        <Suspense fallback={null}>
          <ListsBarEnd />
        </Suspense>
      </TopBar>
      <Suspense fallback={<GiftAppSkeleton />}>
        <ListLoader />
      </Suspense>
    </>
  );
}
