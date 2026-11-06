import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaymentStatus, hasPaidFeatures, type PaymentStatus } from "@/modules/concierge";
import { baseUrlFrom } from "./base-url";
import { cancelZincConnect, disconnectZincAccount, pollZincConnect, saveBuyerPhone, startZincConnect } from "./actions";
import { PayingForGifts } from "./paying-for-gifts";
import { zincDeps } from "./zinc-deps";

const actions = {
  start: startZincConnect,
  poll: pollZincConnect,
  cancel: cancelZincConnect,
  disconnect: disconnectZincAccount,
  savePhone: saveBuyerPhone,
};

// Loads what Settings > Paying for gifts shows (ALL-32). Someone without paid features
// never reaches Zinc; a paid user where Zinc isn't switched on sees a plain line.
export async function PayingForGiftsSection() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const db = createAdminClient();
  let initial: PaymentStatus | null;
  if (!(await hasPaidFeatures(db, userId))) {
    initial = { kind: "not_allowed" };
  } else {
    const baseUrl = baseUrlFrom(await headers());
    const deps = baseUrl ? await zincDeps(db, baseUrl) : null;
    initial = deps ? await getPaymentStatus(userId, deps) : null;
  }
  return <PayingForGifts initial={initial} actions={actions} />;
}
