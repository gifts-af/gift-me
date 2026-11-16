import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { getMyAddress, type MyAddress } from "@/lib/account-address";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTimeZone, timeZoneOptions } from "@/lib/time-zones";
import { getConciergeSettings, getPaymentSummary, type PaymentSummary } from "@/modules/concierge";
import { getMyList } from "@/modules/lists";
import { saveTimezone } from "./actions";
import { addressRowText, paymentRowText } from "./rows";
import { SettingsRow } from "./settings-row";
import { TimeZoneRow } from "./time-zone-row";
import { zincWiring } from "./zinc-deps";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y divide-border rounded-xl border border-border">{children}</div>
    </section>
  );
}

// The Zinc row is one word from the database. A failed load shows "Couldn't load" and leaves
// the rest of Settings alone.
async function loadPaymentSummary(userId: string | undefined): Promise<PaymentSummary | "error"> {
  if (!userId) return "error";
  try {
    const db = createAdminClient();
    const zincOn = (await zincWiring(db)) !== null;
    return await getPaymentSummary(userId, db, zincOn, new Date());
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    logEvent("settings.payment_summary_failed", { user_id: userId, ...errorFields(error) });
    return "error";
  }
}

async function LoadedList() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const [{ data: profile }, concierge, myList, address, requestHeaders, payment] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    getConciergeSettings(),
    getMyList(),
    userId ? getMyAddress(supabase, userId) : Promise.resolve<MyAddress>({ kind: "unavailable" }),
    headers(),
    loadPaymentSummary(userId),
  ]);
  const saved = profile?.timezone ?? null;
  const zones = timeZoneOptions(saved);
  const guess = requestHeaders.get("x-vercel-ip-timezone");
  const fallback = guess && isTimeZone(guess) && zones.includes(guess) ? guess : null;
  // Your address does nothing for you until you have a list (principle 10). A
  // failed read still shows the row, so it can't look like a missing address.
  const showAddress = address.kind !== "none" || myList?.list != null || myList?.loadError != null;
  return (
    <div className="flex flex-col gap-6">
      <Group title="You">
        <div className="px-4">
          <TimeZoneRow zones={zones} saved={saved} fallback={fallback} action={saveTimezone} />
        </div>
        {showAddress && <SettingsRow href="/settings/address" label="My address" value={addressRowText(address)} />}
      </Group>
      <Group title="Reminders">
        <SettingsRow href="/settings/reminders" label="Email" value="By email" />
      </Group>
      <Group title="Gift ideas">
        <SettingsRow href="/settings/over-budget" label="Over-budget allowance" value={`${concierge.overBudgetPct}%`} />
      </Group>
      <Group title="Paying for gifts">
        <SettingsRow href="/settings/paying" label="Zinc" value={paymentRowText(payment)} />
      </Group>
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
          <LoadedList />
        </Suspense>
      </PageFrame>
    </>
  );
}
