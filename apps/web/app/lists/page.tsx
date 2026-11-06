import { Suspense } from "react";
import { saveMyAddressAction, setSharingAction } from "@/app/settings/address-actions";
import { ShareAddressSwitch } from "@/components/address/share-address-switch";
import { AppNav } from "@/components/app-shell/app-nav";
import { TopBar } from "@/components/app-shell/top-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSharing, type Sharing } from "@/lib/account-address";
import { createClient } from "@/lib/supabase/server";
import { GiftApp, GiftAppSkeleton, getMyList } from "@/modules/lists";

// Reads the session cookie, so it has to render inside <Suspense> under
// cacheComponents. Works signed in or out; a guest's list isn't saved.
async function ListLoader() {
  const initial = await getMyList();
  if (!initial) return <GiftApp initial={initial} />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const sharing: Sharing = userId ? await getSharing(supabase, userId) : { kind: "unavailable" };
  return (
    <GiftApp
      initial={initial}
      footer={<ShareAddressSwitch sharing={sharing} saveAction={saveMyAddressAction} setSharingAction={setSharingAction} />}
    />
  );
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
