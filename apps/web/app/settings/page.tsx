import { Suspense } from "react";
import { Account } from "@/components/app-shell/account";
import { PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createClient } from "@/lib/supabase/server";
import { getConciergeSettings } from "@/modules/concierge";
import { saveSettings } from "./actions";
import { SettingsForm } from "./settings-form";

async function LoadedForm() {
  const supabase = await createClient();
  const [{ data: profile }, concierge] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    getConciergeSettings(),
  ]);
  return (
    <SettingsForm
      initial={{ timezone: profile?.timezone ?? null, overBudgetPct: concierge.overBudgetPct }}
      action={saveSettings}
    />
  );
}

export default function SettingsPage() {
  return (
    <>
      <TopBar back={{ href: "/", label: "Home" }} account={<Account />} />
      <PageFrame>
        <PageTitle>Settings</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading your settings…</p>}>
          <LoadedForm />
        </Suspense>
      </PageFrame>
    </>
  );
}
