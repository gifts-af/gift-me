import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createClient } from "@/lib/supabase/server";
import { saveDisplayName } from "../actions";
import { DisplayNameField } from "../display-name-field";

async function LoadedField() {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name").maybeSingle();
  return <DisplayNameField initial={data?.display_name ?? null} action={saveDisplayName} />;
}

export default function NamePage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/settings" label="Settings" />
        <PageTitle>Name</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <LoadedField />
        </Suspense>
      </PageFrame>
    </>
  );
}
