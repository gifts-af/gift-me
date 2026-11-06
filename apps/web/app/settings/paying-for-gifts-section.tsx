import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorFields, logEvent } from "@/lib/log";
import { getPaymentStatus, hasPaidFeatures, hasZincConnection } from "@/modules/concierge";
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
// failed load shows a short line instead of taking Settings down with it. Anyone with a
// Zinc key still saved can always disconnect it (owner, S7).
export async function PayingForGiftsSection() {
  let userId: string | undefined;
  let initial: PayingInitial;
  let walletUrl = "";
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    userId = auth?.claims?.sub;
    if (!userId) return null;
    const db = createAdminClient();
    const paid = await hasPaidFeatures(db, userId);
    const wiring = paid ? await zincWiring(db) : null;
    if (!paid || !wiring) {
      const text = paid ? "Paying for gifts isn't switched on here yet." : null;
      if (await hasZincConnection(userId, db)) {
        initial = { kind: "message", text: text ?? "Buying gifts is paused for your account.", canDisconnect: true };
      } else {
        initial = text ? { kind: "message", text } : { kind: "not_allowed" };
      }
    } else {
      walletUrl = wiring.walletUrl;
      initial = await getPaymentStatus(userId, wiring.deps);
    }
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    logEvent("zinc.settings_load_failed", { user_id: userId ?? null, ...errorFields(error) });
    initial = { kind: "message", text: "We couldn't load your payment settings. Reload the page to try again." };
  }
  return <PayingForGifts initial={initial} actions={actions} walletUrl={walletUrl} />;
}
