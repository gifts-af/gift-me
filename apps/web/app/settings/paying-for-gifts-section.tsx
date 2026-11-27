import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorFields, logEvent } from "@/lib/log";
import { cardBuyer, getPaymentStatus, hasPaidFeatures, hasZincConnection, savedCard } from "@/modules/concierge";
import { siteUrl } from "@/lib/site-url";
import { startCardAction } from "@/app/rounds/actions";
import { cancelZincConnect, disconnectZincAccount, pollZincConnect, removeCardAction, saveBuyerPhone, saveCardPhoneAction, startZincConnect } from "./actions";
import { CardPaying, type CardPayingInitial, type SavedCardView } from "./card-paying";
import { PayingForGifts, type PayingInitial } from "./paying-for-gifts";
import { stripeWiring, zincWiring } from "@/lib/wiring";

const actions = {
  start: startZincConnect,
  poll: pollZincConnect,
  cancel: cancelZincConnect,
  disconnect: disconnectZincAccount,
  savePhone: saveBuyerPhone,
};

const cardActions = {
  startCard: startCardAction.bind(null, "settings"),
  remove: removeCardAction,
  savePhone: saveCardPhoneAction,
};

/** The saved card's brand and last four, read live from Stripe; "unreadable" when Stripe can't be asked. */
async function liveCard(db: ReturnType<typeof createAdminClient>, userId: string): Promise<SavedCardView> {
  try {
    const stripe = await stripeWiring(db);
    if (!stripe) return "unreadable";
    return (await savedCard({ db, now: new Date(), stripe, siteUrl: siteUrl() }, userId)) ?? "unreadable";
  } catch (error) {
    unstable_rethrow(error);
    // Stripe's error code only (E6).
    logEvent("card.read_failed", { user_id: userId, ...errorFields(error) });
    return "unreadable";
  }
}

// Loads what Settings > Paying for gifts shows (ALL-32). A card buyer sees their card instead of
// Zinc (ALL-98 mock-ups 4a to 4c); a wallet buyer sees today's screen. Someone without paid features
// never reaches Zinc; a paid user where Zinc isn't switched on sees a plain line, and a
// failed load shows a short line instead of taking Settings down with it. Anyone with a
// Zinc key still saved can always disconnect it (owner, S7).
export async function PayingForGiftsSection({ cardReturn = null }: { cardReturn?: string | null } = {}) {
  let userId: string | undefined;
  let initial: PayingInitial;
  let card: CardPayingInitial | null = null;
  let walletUrl = "";
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    userId = auth?.claims?.sub;
    if (!userId) return null;
    const db = createAdminClient();
    const paid = await hasPaidFeatures(db, userId);
    const buyer = paid ? await cardBuyer({ db, now: new Date() }, userId) : null;
    const wiring = paid && buyer?.mode !== "connect" ? await zincWiring(db) : null;
    if (buyer?.mode === "connect") {
      card = { on: buyer.on, card: buyer.hasCard ? await liveCard(db, userId) : null, phone: buyer.phone, cardReturn };
      initial = { kind: "not_allowed" };
    } else if (!paid || !wiring) {
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
  if (card) return <CardPaying initial={card} actions={cardActions} />;
  return <PayingForGifts initial={initial} actions={actions} walletUrl={walletUrl} />;
}
