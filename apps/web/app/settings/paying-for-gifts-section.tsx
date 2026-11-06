import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/log";
import { getPaymentStatus, hasPaidFeatures } from "@/modules/concierge";
import { cancelZincConnect, disconnectZincAccount, pollZincConnect, saveBuyerPhone, startZincConnect } from "./actions";
import { PayingForGifts, type PayingInitial } from "./paying-for-gifts";
import { zincWiring } from "./zinc-deps";

const actions = {
  start: startZincConnect,
  poll: pollZincConnect,
  cancel: cancelZincConnect,
  disconnect: disconnectZincAccount,
  savePhone: saveBuyerPhone,
};

// Loads what Settings > Paying for gifts shows (ALL-32). Someone without paid features
// never reaches Zinc; a paid user where Zinc isn't switched on sees a plain line, and a
// failed load shows a short line instead of taking Settings down with it.
export async function PayingForGiftsSection() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  let initial: PayingInitial;
  let walletUrl = "";
  try {
    const db = createAdminClient();
    if (!(await hasPaidFeatures(db, userId))) {
      initial = { kind: "not_allowed" };
    } else {
      const wiring = await zincWiring(db);
      if (!wiring) {
        initial = { kind: "message", text: "Paying for gifts isn't switched on here yet." };
      } else {
        walletUrl = wiring.walletUrl;
        initial = await getPaymentStatus(userId, wiring.deps);
      }
    }
  } catch (error) {
    logEvent("zinc.settings_load_failed", { user_id: userId, name: error instanceof Error ? error.name : "unknown" });
    initial = { kind: "message", text: "We couldn't load your payment settings. Reload the page to try again." };
  }
  return <PayingForGifts initial={initial} actions={actions} walletUrl={walletUrl} />;
}
