import { unstable_rethrow } from "next/navigation";
import { AccessCheckFailed, readAccess } from "@/components/concierge-gate";
import { SettingsRow } from "@/components/settings-row";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { zincWiring } from "@/lib/wiring";
import { getConciergeSettings, getPaymentSummary, type PaymentSummary } from "@/modules/concierge";
import { Group } from "./group";
import { paymentRowText } from "./rows";

// The Zinc row is one word from the database. A failed load shows "Couldn't load" and leaves
// the rest of Settings alone.
async function loadPaymentSummary(): Promise<PaymentSummary | "error"> {
  let userId: string | null = null;
  try {
    const { data: auth, error } = await (await createClient()).auth.getClaims();
    if (error) throw error;
    userId = auth?.claims?.sub ?? null;
    if (!userId) return "error";
    const db = createAdminClient();
    const zincOn = (await zincWiring(db)) !== null;
    return await getPaymentSummary(userId, db, zincOn, new Date());
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure.
    logEvent("settings.payment_summary_failed", { user_id: userId, ...errorFields(error) });
    return "error";
  }
}

/** The concierge's part of Settings: only with access, and nothing is loaded without it. */
export async function ConciergeGroups() {
  const state = await readAccess();
  if (!state) return <AccessCheckFailed />;
  if (!state.access) return null;
  const [concierge, payment] = await Promise.all([getConciergeSettings(), loadPaymentSummary()]);
  return (
    <>
      <Group title="Reminders">
        <SettingsRow href="/settings/reminders" label="Email" value="By email" />
      </Group>
      <Group title="Gift ideas">
        <SettingsRow href="/settings/over-budget" label="Over-budget allowance" value={`${concierge.overBudgetPct}%`} />
      </Group>
      <Group title="Paying for gifts">
        <SettingsRow href="/settings/paying" label="Zinc" value={paymentRowText(payment)} />
      </Group>
    </>
  );
}
