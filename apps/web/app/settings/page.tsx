import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createClient } from "@/lib/supabase/server";
import { getConciergeSettings } from "@/modules/concierge";
import { saveSettings, sendTestEmail } from "./actions";
import { SettingsForm } from "./settings-form";
import { TestEmailButton } from "./test-email-button";

async function LoadedForm() {
  const supabase = await createClient();
  const [{ data: profile }, concierge] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    getConciergeSettings(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <SettingsForm
        initial={{ timezone: profile?.timezone ?? null, overBudgetPct: concierge.overBudgetPct }}
        action={saveSettings}
      />
      <TestEmailButton action={sendTestEmail} />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/" label="Give" />
        <PageTitle>Settings</PageTitle>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading your settings…</p>}>
          <LoadedForm />
        </Suspense>
      </PageFrame>
    </>
  );
}
