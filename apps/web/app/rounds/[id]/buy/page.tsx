import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { APP_NAME } from "@/lib/brand";
import { errorFields, logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { capsFor, capsForPayer, cardBuyer, getZincWallet, type RoundPageIdea, type RoundPageView } from "@/modules/concierge";
import { settingInt, zincWiring } from "@/lib/wiring";
import { buyAction, startCardAction } from "../../actions";
import { OtherAccount } from "../../access";
import { loadRound, shipToChoices } from "../../load";
import { ConfirmScreen, type ConfirmCard } from "./confirm-screen";

// For buyAction on this page: buying places the gifts at Zinc, which can run for a while (one
// zinc_place_budget_ms plus a request in flight). 300 s is the most Vercel's Fluid compute
// allows on our plan. Next needs a literal here.
export const maxDuration = 300;

// The confirm page (ALL-29 AC-2, AC-4), from an email's "Buy this" or the round screen's
// "Buy n gifts": /rounds/<id>/buy?ideas=<id>,<id>. Loading only reads (AC-4a); the one button
// buys through buyAction. The link's `over` flag is ignored: whether it's over the budget is
// worked out from the round, and only the page's own "Buy anyway" says yes to it.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = Promise<{ id: string }>;
type Search = Promise<{ ideas?: string; over?: string; card?: string }>;

export default function BuyPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <Loaded params={params} searchParams={searchParams} />
        </Suspense>
      </PageFrame>
    </>
  );
}

/** The link's idea ids: UUIDs, no repeats, at most the round's idea count; null when malformed. */
function pickedIds(raw: string | undefined, max: number): string[] | null {
  const ids = (raw ?? "").split(",").filter(Boolean);
  const parsed = z.array(z.uuid()).min(1).max(max).safeParse(ids);
  return parsed.success ? [...new Set(parsed.data)] : null;
}

/** Why these picks can't be bought now (AC-12b, AC-18, AC-30, AC-30a), or null. */
function blockedText(view: RoundPageView, picks: RoundPageIdea[]): string | null {
  if (view.closedText) return view.closedText;
  const onOrders = picks.filter((i) => view.liveOrders.some((o) => o.ideaId === i.id));
  if (onOrders.length > 0) return `Already ordered: ${onOrders.map((i) => i.title).join(", ")}`;
  if (picks.some((i) => i.status !== "proposed")) return "These ideas were replaced";
  const claimed = picks.find((i) => i.claimed);
  if (claimed) return `Someone else is getting ${claimed.title}`;
  const cut = picks.find((i) => i.noLongerShared);
  if (cut) return `${cut.title} is no longer shared`;
  const mine = picks.find((i) => i.claimedByMe);
  if (mine) return `${mine.title} is already on one of your orders`;
  if (view.round.status !== "awaiting_approval") return "Nothing can be bought from this round right now";
  return null;
}

/** The Zinc balance for the money notice; null when Zinc is off here, not connected, or unreadable. */
async function balanceCents(userId: string): Promise<number | null> {
  try {
    const wiring = await zincWiring(createAdminClient());
    return wiring ? (await getZincWallet(userId, wiring.deps)).balanceCents : null;
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    logEvent("zinc.wallet_unavailable", { user_id: userId, ...errorFields(error) });
    return null;
  }
}

async function Loaded({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, { ideas: raw, card: back }] = await Promise.all([params, searchParams]);
  const loaded = await loadRound(id);
  if (loaded.kind === "other") return <OtherAccount />;
  const { view, userId } = loaded;

  const ids = pickedIds(raw, view.ideas.length);
  if (!ids) notFound();
  const byId = new Map(view.ideas.map((i) => [i.id, i]));
  if (ids.some((i) => !byId.has(i))) notFound();
  const picks = ids.map((i) => byId.get(i)!).sort((a, b) => a.rank - b.rank);

  const db = createAdminClient();
  const buyer = await cardBuyer({ db, now: new Date() }, userId);
  const [feeCents, marginPct, giftMessageMax, choices, balance] = await Promise.all([
    settingInt(db, "zinc_order_fee_cents"),
    settingInt(db, "order_price_margin_pct"),
    settingInt(db, "zinc_gift_message_max_chars"),
    shipToChoices(view.round.personId, userId),
    // A card buyer has no Zinc balance.
    buyer.mode === "connect" ? null : balanceCents(userId),
  ]);
  const pct = view.overBudgetPct ?? 0;
  const round = { budget_cents: view.round.budgetCents };
  const totals = picks.map((i) => i.totalCents);
  // The most the buyer can be charged, as approveAndBuy will cap it; past the allowance there's none.
  // A card buyer's is the whole charge at the goods caps, fee included (AC-4).
  const caps =
    buyer.mode === "connect"
      ? capsForPayer(round, totals, { over_budget_pct: pct }, true, buyer.payer, marginPct, 0)
      : capsFor(round, totals, { over_budget_pct: pct }, true, { feeCents, marginPct }, 0);
  const card: ConfirmCard | undefined =
    buyer.mode === "connect"
      ? {
          on: buyer.on,
          hasCard: buyer.hasCard,
          needsPhone: buyer.phone === null,
          fee: buyer.fee,
          capGoodsCents: typeof caps === "string" ? null : caps.caps.reduce((a, b) => a + b, 0),
          // Only "cancelled" comes back to the gift; the return route sends the rest to Settings.
          cardReturn: back === "cancelled" ? back : null,
          startCard: startCardAction.bind(null, { roundId: id, ideaIds: ids }),
        }
      : undefined;

  const name = view.round.personName ?? "them";
  return (
    <>
      <BackLink href={`/rounds/${id}`} label={view.round.personName ? `Gift for ${view.round.personName}` : "Gift"} />
      <ConfirmScreen
        roundId={id}
        personId={view.round.personId}
        personName={name}
        ideas={picks}
        blocked={blockedText(view, picks)}
        budgetCents={view.round.budgetCents}
        overBudgetPct={pct}
        feeCents={feeCents}
        neverMoreThanCents={typeof caps === "string" ? null : caps.neverMoreThanCents}
        giftMessageMax={giftMessageMax}
        balanceCents={balance}
        recipient={choices.recipient}
        buyerAddress={choices.buyerAddress}
        returnPath={`/rounds/${id}/buy?ideas=${ids.join(",")}`}
        buyAction={buyAction}
        card={card}
      />
    </>
  );
}
