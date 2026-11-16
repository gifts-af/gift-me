import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { sendTestEmail } from "../actions";
import { TestEmailButton } from "../test-email-button";

export default function RemindersPage() {
  return (
    <>
      <TopBar>
        <AppNav />
      </TopBar>
      <PageFrame>
        <BackLink href="/settings" label="Settings" />
        <PageTitle>Reminders</PageTitle>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-1.5">
            <p className="text-[15px]">By email</p>
            <p className="text-[13px] text-muted-foreground">More ways to be reminded are coming.</p>
          </section>
          <TestEmailButton action={sendTestEmail} />
        </div>
      </PageFrame>
    </>
  );
}
