import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { birthdaySharingOn, getMyBirthday } from "@/lib/account-birthday";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { getMyList } from "@/modules/lists";
import { removeBirthdayAction, saveBirthdayAction } from "../birthday-actions";
import { BirthdayForm } from "../birthday-form";
import { showBirthdayRow } from "../rows";

async function LoadedBirthday() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/");
  const [myList, birthday, on] = await Promise.all([
    getMyList(),
    getMyBirthday(supabase, userId),
    birthdaySharingOn(appSettingInt),
  ]);
  if (!showBirthdayRow(birthday, myList, on)) redirect("/settings");
  if (birthday.kind === "unavailable") {
    return <p className="text-[15px] text-muted-foreground">We couldn&apos;t load your birthday. Try again.</p>;
  }
  return (
    <BirthdayForm
      saved={birthday.kind === "saved" ? birthday : null}
      on={on}
      saveAction={saveBirthdayAction}
      removeAction={removeBirthdayAction}
    />
  );
}

export default function BirthdayPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/settings" label="Settings" />
        <PageTitle>Birthday</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <LoadedBirthday />
        </Suspense>
      </PageFrame>
    </>
  );
}
