import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { createClient } from "@/lib/supabase/server";
import { getConciergeSettings } from "@/modules/concierge";
import { saveSettings, sendTestEmail } from "./actions";
import { PayingForGiftsSection } from "./paying-for-gifts-section";
import { SettingsForm } from "./settings-form";
import { TestEmailButton } from "./test-email-button";

// For the Server Actions on this page: finishing Zinc setup or saving the phone places held gifts.
// Placing gifts at Zinc can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

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
      <PayingForGiftsSection />
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
