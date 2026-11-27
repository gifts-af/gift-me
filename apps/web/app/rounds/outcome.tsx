import Link from "next/link";
import { zincFeeNotice } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApproveError, ApproveResult, GiftOutcome, ReplaceError } from "@/modules/concierge";
import { money } from "@/app/people/[id]/money";

// What the confirm and fix pages say after Buy (ALL-29 AC-2, AC-18, AC-19): every result of
// approveAndBuy and replaceFailedOrder, in plain words, with what happens next (customers are
// always told). The actions return only these codes; the words live here.

export type BuyError = ApproveError | ReplaceError | "zinc_off" | "session" | "bad_form";
export type BuyResult = Extract<ApproveResult, { ok: true }> | { ok: false; error: BuyError };

/**
 * The money notice (decision 53), always shown next to anything that places an order: the
 * confirm page's Buy and every buy button on the fix page. The balance only where it was read.
 */
export function MoneyNotice({ feeCents, balanceCents }: { feeCents: number; balanceCents?: number | null }) {
  return (
    <div role="note" className="flex flex-col gap-1 rounded-lg bg-warning-soft px-2.5 py-2 text-[13px] text-warning">
      <span>{zincFeeNotice(feeCents)}</span>
      {balanceCents !== undefined && (
        <span>{balanceCents !== null ? `Your Zinc balance: ${money(balanceCents)}.` : "We couldn't read your Zinc balance just now."}</span>
      )}
      <span>This is a real purchase and can&apos;t be undone once placed.</span>
    </div>
  );
}

/** For a thrown action: a purchase may have gone through, so never just "try again". */
export const UNKNOWN = "Something went wrong. Check the gift's page before trying again.";

type Words = { title: string; body: string | null };

const HELD: Record<string, Words> = {
  funds: { title: "Waiting on your Zinc balance", body: "Add money to your Zinc balance and we'll order it. We've emailed you how." },
  setup: { title: "Waiting on your Zinc setup", body: "Finish Paying for gifts in Settings and we'll order it." },
  address: { title: "Waiting on an address", body: "Add the address and we'll order it. We've emailed you how." },
  unconfirmed: { title: "Waiting on Zinc", body: "Zinc hasn't confirmed the order yet. We'll email you either way." },
  paused: { title: "Not ordered yet", body: "Buying is paused right now. We'll order it when it's back on." },
  not_allowed: { title: "Not ordered yet", body: "Buying gifts is open to test accounts during the alpha." },
};
const HELD_OTHER: Words = { title: "Not ordered yet", body: "We'll try again if there's time, and email you what happens." };

const FAILED: Record<string, Words> = {
  price_up: { title: "Price went up", body: "We didn't buy it. We've emailed you what you can do." },
  out_of_stock: { title: "It's out of stock", body: "We didn't buy it. We've emailed you what you can do." },
  too_late: { title: "It can't arrive in time", body: "We didn't buy it. We've emailed you what you can do." },
  address_withdrawn: { title: "The address isn't shared any more", body: "We didn't buy it. We've emailed you what you can do." },
  address_rejected: { title: "The store couldn't ship to that address", body: "We didn't buy it. We've emailed you what you can do." },
  store_cancelled: { title: "The store cancelled it", body: "The money is back in your Zinc wallet. We've emailed you what you can do." },
};
const FAILED_OTHER: Words = { title: "The store couldn't take the order", body: "We didn't buy it. We've emailed you what you can do." };

const ERRORS: Record<BuyError, Words> = {
  replaced: { title: "These ideas were replaced", body: "Nothing was bought. See the ideas on offer now." },
  claimed: { title: "Someone else got it", body: "Nothing was bought. Pick another gift." },
  busy: { title: "Busy, try again", body: "This gift is being worked on right now. Try again in a minute." },
  not_open: { title: "This can't be bought now", body: "Nothing was bought. See what happened on the gift's page." },
  needs_confirmation: { title: "This is over the budget now", body: "Nothing was bought. Buy anyway, or pick something else." },
  over_budget: { title: "Over the most you allowed", body: "Nothing was bought. Pick something cheaper." },
  no_address: { title: "We need an address", body: "Nothing was bought." },
  not_allowed: { title: "Not on your account yet", body: "Buying gifts is open to test accounts during the alpha." },
  not_shared: { title: "Their list isn't shared with you any more", body: "Nothing was bought." },
  already_bought: { title: "Already on one of your orders", body: "Nothing was bought twice." },
  already_ordered: { title: "Already ordered", body: "This gift was ordered already. Nothing more was bought." },
  gift_message_too_long: { title: "The gift note is too long", body: "Shorten it and try again." },
  bad_ideas: { title: "That link isn't right", body: "Nothing was bought. Open the gift's page and pick again." },
  not_found: { title: "That didn't go through", body: "Nothing was bought. Reload and try again." },
  not_current: { title: "Already sorted out", body: "This gift was replaced or fixed already. Nothing more was bought." },
  price_changed: { title: "The price changed again", body: "Nothing was bought. Check today's price again." },
  once: { title: "The price went up again", body: "Nothing was bought. Pick another idea." },
  unavailable: { title: "We can't get today's price", body: "Nothing was bought. Pick another idea." },
  zinc_off: { title: "Buying isn't switched on here", body: "Nothing was bought." },
  no_card: { title: "Add a card first", body: "Nothing was bought. Add a card, then tap Buy again." },
  connect_off: { title: "Buying is paused", body: "Nothing was bought. Paying by card is switched off right now." },
  session: { title: "Your session ended", body: "Sign in again. Nothing was bought." },
  bad_form: { title: "That didn't go through", body: "Nothing was bought. Reload and try again." },
};

export function outcomeWords(result: BuyResult): Words {
  if (!result.ok) return ERRORS[result.error];
  if (result.status === "ordered") return { title: "Ordered", body: "You'll find its delivery updates on the gift's page." };
  if (result.status === "failed") return FAILED[result.reason ?? ""] ?? FAILED_OTHER;
  return HELD[result.reason ?? ""] ?? HELD_OTHER;
}

/** "We've emailed you ...": only the gift the round's reason is about was surely just emailed. */
const EMAILED = / We've emailed you [^.]+\.$/;

function giftWords(g: GiftOutcome, gifts: GiftOutcome[], roundReason: string | null): Words {
  // Already on its way before this buy: its title says it all.
  if (g.status === "ordered" && g.reason) return { title: g.reason === "delivered" ? "Delivered" : "Shipped", body: null };
  const words = outcomeWords({ ok: true, status: g.status, reason: g.reason });
  const about = g.reason === roundReason;
  // An unconfirmed gift keeps the round from trying the others.
  if (g.status === "held" && words === HELD_OTHER && (!about || gifts.some((x) => x.reason === "unconfirmed"))) {
    return { ...words, body: "See what happens next on the gift's page." };
  }
  if (about || !words.body) return words;
  return { ...words, body: words.body.replace(EMAILED, g.status === "failed" ? " See what you can do on the gift's page." : "") };
}

const NEUTRAL = "What happened with your gifts";

/** The heading over several gifts: how many were ordered, or no count while that isn't certain. */
function severalTitle(gifts: GiftOutcome[]): string {
  if (gifts.some((g) => g.reason === "unconfirmed" || g.reason === "store_cancelled")) return NEUTRAL;
  const ordered = gifts.filter((g) => g.status === "ordered").length;
  return ordered > 0 ? `${ordered} of ${gifts.length} gifts ordered` : "No gifts ordered yet";
}

/** Several gifts that came to different things: each by name, with its own words. */
function GiftOutcomes({ gifts, roundReason }: { gifts: GiftOutcome[]; roundReason: string | null }) {
  return (
    <>
      <p className="text-[17px] font-bold">{severalTitle(gifts)}</p>
      <ul className="flex flex-col divide-y divide-border">
        {gifts.map((g) => {
          const words = giftWords(g, gifts, roundReason);
          return (
            <li key={g.orderId} className="flex flex-col gap-0.5 py-2 last:pb-0">
              <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{g.title}</span>
              <span className={cn("text-[15px] font-semibold", g.status === "ordered" ? "text-success" : "text-warning")}>{words.title}</span>
              {words.body && <span className="text-[15px] text-muted-foreground">{words.body}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The result panel after Buy: what happened, and the way back to the round. */
export function Outcome({ result, roundId, children }: { result: BuyResult; roundId: string; children?: React.ReactNode }) {
  const gifts = result.ok ? result.gifts : undefined;
  const words = gifts === "unknown" ? { title: NEUTRAL, body: "See each one on the gift's page." } : outcomeWords(result);
  const good = result.ok && result.status === "ordered" && !gifts;
  // Something was ordered or is waiting (or may be), so the gift's own page comes next.
  const toGift =
    result.ok && (gifts === "unknown" || (gifts ? gifts.some((g) => g.status !== "failed") : result.status !== "failed"));
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className={cn("flex flex-col gap-1 rounded-xl p-3", good ? "bg-success-soft" : "border border-border")}>
        {result.ok && Array.isArray(gifts) ? (
          <GiftOutcomes gifts={gifts} roundReason={result.reason} />
        ) : (
          <>
            <p className={cn("text-[17px] font-bold", good && "text-success")}>{words.title}</p>
            {words.body && <p className="text-[15px] text-muted-foreground">{words.body}</p>}
          </>
        )}
      </div>
      {children}
      <Button asChild variant="outline">
        <Link href={`/rounds/${roundId}`}>{toGift ? "Back to the gift" : "See all ideas"}</Link>
      </Button>
    </div>
  );
}
