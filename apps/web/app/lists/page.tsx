import { Suspense } from "react";
import { saveMyAddressAction, setSharingAction } from "@/app/settings/address-actions";
import { saveDisplayName } from "@/app/settings/actions";
import { ShareAddressSwitch } from "@/components/address/share-address-switch";
import { AppNav } from "@/components/app-shell/app-nav";
import { BirthdayHint } from "@/components/birthday-hint";
import { TopBar } from "@/components/app-shell/top-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSharing, type Sharing } from "@/lib/account-address";
import { birthdaySharingOn, getMyBirthday, type MyBirthday } from "@/lib/account-birthday";
import { appSettingInt } from "@/lib/app-settings";
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
  const [sharing, birthday, birthdayOn, profile] = await Promise.all([
    userId ? getSharing(supabase, userId) : Promise.resolve<Sharing>({ kind: "unavailable" }),
    userId ? getMyBirthday(supabase, userId) : Promise.resolve<MyBirthday>({ kind: "unavailable" }),
    userId ? birthdaySharingOn(appSettingInt) : false,
    // ALL-136: no name yet means Share asks for one. A failed read doesn't ask.
    supabase.from("profiles").select("display_name").maybeSingle(),
  ]);
  const needsName = !profile.error && profile.data != null && !profile.data.display_name;
  return (
    <GiftApp
      initial={initial}
      needsName={needsName}
      saveName={saveDisplayName}
      shareHint={birthdayOn && birthday.kind === "none" ? <BirthdayHint /> : null}
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
