import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { committedSpendCents, priceCheckNotice } from "@gifts-af/core";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardBuyer, cardGoods, isId, replacementMaxCents } from "@/modules/concierge";
import { settingInt } from "@/lib/wiring";
import { checkPriceAction, pickAgainAction, replaceAction, skipRoundAction, startCardAction } from "../../../actions";
import { OtherAccount } from "../../../access";
import { loadRound, shipToChoices } from "../../../load";
import { FixScreen, type FixCard } from "./fix-screen";

// For replaceAction on this page: replacing places the new gift at Zinc, which can run for a
// while. 300 s is the most Vercel's Fluid compute allows on our plan. Next needs a literal here.
export const maxDuration = 300;

// One failed gift's fix page (ALL-29 AC-14, AC-15, AC-15a), from the "needs your attention" email
// or the round screen's "Fix this". Loading only reads (AC-4a): today's price is checked only on
// a tap (checkPriceAction), and buying happens in replaceAction.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = Promise<{ id: string; orderId: string }>;
type Search = Promise<{ card?: string }>;

const ADDRESS_FAILURES = new Set(["address_withdrawn", "address_rejected"]);

export default function FixPage({ params, searchParams }: { params: Params; searchParams: Search }) {
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

async function Loaded({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id, orderId }, { card: cardBack }] = await Promise.all([params, searchParams]);
  if (!isId(orderId)) notFound();
  const loaded = await loadRound(id);
  if (loaded.kind === "other") return <OtherAccount />;
  const { view, userId } = loaded;
  const name = view.round.personName ?? "them";
  const back = <BackLink href={`/rounds/${id}`} label={view.round.personName ? `Gift for ${view.round.personName}` : "Gift"} />;

  const order = view.failedOrders.find((o) => o.id === orderId);
  const live = view.liveOrders.find((o) => o.id === orderId);
  // Fixed, replaced, or the round is over: say what happened, and nothing to buy (AC-18).
  const done = view.closedText ?? (live ? `Already ordered: ${live.title}` : order ? null : "This gift has already been sorted out");
  if (done !== null || !order) {
    return (
      <>
        {back}
        <PageTitle>{`Gift for ${name}`}</PageTitle>
        <p role="status" className="rounded-xl border border-border p-3 text-[15px] font-semibold">
          {done}
        </p>
        <Button asChild variant="outline">
          <Link href={`/rounds/${id}`}>See all ideas</Link>
        </Button>
      </>
    );
  }

  const idea = view.ideas.find((i) => i.id === order.ideaId) ?? null;
  // Address failures re-offer the same gift with a different address, never another one (AC-15a).
  const nextBest = ADDRESS_FAILURES.has(order.failureType ?? "") ? null : (view.ideas.find((i) => i.id === view.nextBestIdeaId) ?? null);
  // What the round's other live orders hold, as replaceFailedOrder counts it.
  const committed = committedSpendCents(
    view.liveOrders.map((o) => ({ id: o.id, status: "placing", maxPriceCents: o.maxPriceCents, finalTotalCents: o.totalCents, feeCents: o.feeCents })),
  );
  // The ways out besides buying (drop_failed_order, cancel_held): skipping only while nothing in
  // the round is held, being ordered or on its way; picking again only when this is the one gift.
  const canSkip = view.liveOrders.length === 0;
  const canPick = canSkip && view.round.status === "needs_attention" && view.failedOrders.length === 1;
  const db = createAdminClient();
  const deps = { db, now: new Date() };
  const [lookupCents, feeCents, choices, buyer] = await Promise.all([
    settingInt(db, "zinc_lookup_cents"),
    settingInt(db, "zinc_order_fee_cents"),
    shipToChoices(view.round.personId, userId),
    cardBuyer(deps, userId),
  ]);
  let card: FixCard | undefined;
  if (buyer.mode === "connect") {
    // "Most you'll pay" for each gift that can be bought here at its total on the page; Buy sends it back.
    const targets = [idea, nextBest].filter((i) => i !== null);
    const maxes = await Promise.all(
      targets.map((i) => replacementMaxCents(deps, { userId, roundId: id, failedOrderId: order.id, totalCents: i.totalCents })),
    );
    card = {
      on: buyer.on,
      hasCard: buyer.hasCard,
      needsPhone: buyer.phone === null,
      fee: buyer.fee,
      fees: buyer.payer.fees,
      goodsFor: cardGoods(targets),
      // Only "cancelled" comes back to the gift; the return route sends the rest to Settings.
      cardReturn: cardBack === "cancelled" ? cardBack : null,
      startCard: startCardAction.bind(null, { roundId: id, ideaIds: [], failedOrderId: order.id }),
      maxFor: Object.fromEntries(targets.map((i, n) => [i.id, maxes[n]])),
    };
  }

  return (
    <>
      {back}
      <PageTitle>{`Gift for ${name}`}</PageTitle>
      <FixScreen
        roundId={id}
        personId={view.round.personId}
        personName={name}
        shipByDeadline={view.round.shipByDeadline}
        order={order}
        idea={idea}
        nextBest={nextBest}
        budgetCents={view.round.budgetCents}
        overBudgetPct={view.overBudgetPct ?? 0}
        committedCents={committed}
        feeCents={feeCents}
        priceCheckNotice={priceCheckNotice(lookupCents)}
        recipient={choices.recipient}
        buyerAddress={choices.buyerAddress}
        returnPath={`/rounds/${id}/fix/${orderId}`}
        checkPriceAction={checkPriceAction}
        replaceAction={replaceAction}
        occasionKind={view.round.occasionKind}
        canPick={canPick}
        canSkip={canSkip}
        pickAgainAction={pickAgainAction}
        skipRoundAction={skipRoundAction}
        card={card}
      />
    </>
  );
}
