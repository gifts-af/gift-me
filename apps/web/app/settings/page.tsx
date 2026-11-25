import { headers } from "next/headers";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { getMyAddress, type MyAddress } from "@/lib/account-address";
import { birthdaySharingOn, getMyBirthday, type MyBirthday } from "@/lib/account-birthday";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { isTimeZone, timeZoneOptions } from "@/lib/time-zones";
import { getMyList } from "@/modules/lists";
import { saveTimezone } from "./actions";
import { ConciergeGroups } from "./concierge-groups";
import { Group } from "./group";
import { addressRowText, birthdayRowText, showBirthdayRow } from "./rows";
import { SettingsRow } from "@/components/settings-row";
import { TimeZoneRow } from "./time-zone-row";

async function YourGroup() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const [{ data: profile }, myList, address, birthday, birthdayOn, requestHeaders] = await Promise.all([
    supabase.from("profiles").select("timezone, display_name").maybeSingle(),
    getMyList(),
    userId ? getMyAddress(supabase, userId) : Promise.resolve<MyAddress>({ kind: "unavailable" }),
    userId ? getMyBirthday(supabase, userId) : Promise.resolve<MyBirthday>({ kind: "unavailable" }),
    userId ? birthdaySharingOn(appSettingInt) : false,
    headers(),
  ]);
  const saved = profile?.timezone ?? null;
  const guess = requestHeaders.get("x-vercel-ip-timezone");
  const fallback = guess && isTimeZone(guess) ? guess : null;
  const zones = timeZoneOptions(saved, fallback);
  // Your address does nothing for you until you have a list (principle 10). A
  // failed read still shows the row, so it can't look like a missing address.
  const showAddress = address.kind !== "none" || myList?.list != null || myList?.loadError != null;
  return (
    <Group title="You">
      <SettingsRow href="/settings/name" label="Name" value={profile?.display_name || "Not set"} />
      <div className="px-4">
        <TimeZoneRow zones={zones} saved={saved} fallback={fallback} action={saveTimezone} />
      </div>
      {showAddress && <SettingsRow href="/settings/address" label="My address" value={addressRowText(address)} />}
      {showBirthdayRow(birthday, myList, birthdayOn) && (
        <SettingsRow href="/settings/birthday" label="Birthday" value={birthdayRowText(birthday)} />
      )}
    </Group>
  );
}

export default function SettingsPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/give" label="Give" />
        <PageTitle>Settings</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading your settings…</p>}>
          <div className="flex flex-col gap-6">
            <YourGroup />
            <ConciergeGroups />
          </div>
        </Suspense>
      </PageFrame>
    </>
  );
}
