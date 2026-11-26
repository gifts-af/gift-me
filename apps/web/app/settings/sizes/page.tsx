import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { getMySizes, sizesSharingOn } from "@/lib/account-sizes";
import { appSettingInt } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { getMyList } from "@/modules/lists";
import { showSizesRow } from "../rows";
import { removeSizesAction, saveSizesAction } from "../sizes-actions";
import { SizesForm } from "../sizes-form";

async function LoadedSizes() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/");
  const [myList, sizes, on] = await Promise.all([
    getMyList(),
    getMySizes(supabase, userId),
    sizesSharingOn(appSettingInt),
  ]);
  if (!showSizesRow(sizes, myList, on)) redirect("/settings");
  if (sizes.status === "unavailable") {
    return <p className="text-[15px] text-muted-foreground">We couldn&apos;t load your sizes. Try again.</p>;
  }
  return <SizesForm saved={sizes.items} on={on} saveAction={saveSizesAction} removeAction={removeSizesAction} />;
}

export default function SizesPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/settings" label="Settings" />
        <PageTitle>Sizes and favorites</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <LoadedSizes />
        </Suspense>
      </PageFrame>
    </>
  );
}
