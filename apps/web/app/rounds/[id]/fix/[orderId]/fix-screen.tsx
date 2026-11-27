"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { classifyTotal, goodsCapCents, overBudgetLimitCents, type FeeInputs } from "@gifts-af/core";
import { IdeaPhoto } from "@/components/idea-photo";
import { chooseBy, shortDate } from "@/lib/occasion-format";
import { Button } from "@/components/ui/button";
import type { FeeSheet, RoundPageIdea, RoundPageOrder } from "@/modules/concierge";
import { money } from "@/app/people/[id]/money";
import { OverBudgetSheet } from "../../../over-budget-sheet";
import { WaysOut, type PickAgainResult, type SkipResult } from "../../../ways-out";
import {
  MoneyNotice,
  Outcome,
  UNKNOWN,
  outcomeWords,
  type BuyResult,
} from "../../../outcome";
import { AddCard, BuyingPaused, CardMoneyNotice, CardReturnNotice, CostLine, FeeInfo, SavedCard, type StartCardResult } from "../../../card-ui";
import {
  EMPTY_ADDRESS,
  OtherAddressForm,
  myAddressHref,
  personAddressHref,
  place,
  putShipTo,
  type Place,
  type RecipientAddress,
  type ShipChoice,
} from "../../../ship-to";

// The fix page for one failed gift (ALL-29 AC-14, AC-15, AC-15a, S3). Opening it costs nothing
// (AC-4a): today's price is looked up only when "Check today's price" is tapped, and the money
// notice sits by that button. Every button that buys has the money notice by it too (decision
// 53), and says it buys. A replacement over the budget asks first, as the round screen does,
// and only then reads "Buy anyway"; the server checks the budget and the allowance again. Below
// the buying, "Pick a different gift" and "Skip" are the ways out that buy nothing (WaysOut, T102).

export type FixResult = BuyResult;
export type CheckResult =
  /** `maxCents`: a card buyer's "Most you'll pay" at today's price; null for a wallet buyer. */
  | { ok: true; oldCents: number; newCents: number; maxCents?: number | null }
  | {
      ok: false;
      error:
        | "not_allowed"
        | "not_current"
        | "not_open"
        | "unavailable"
        | "once"
        | "zinc_off"
        | "session"
        | "bad_form";
    };

/**
 * A card buyer's fix page (mock-ups 3a to 3c). Paused: nothing to add or buy. No card: Add a card,
 * which comes back here and buys nothing. With one: the gift at today's price (or its saved
 * estimate), "Most you'll pay", and Buy again.
 */
export type FixCard = {
  on: boolean;
  hasCard: boolean;
  needsPhone: boolean;
  fee: FeeSheet;
  /** Today's fee inputs, as the server judges a card buyer's charges (CardBuyer.payer.fees). */
  fees: FeeInputs;
  /** The price, shipping and tax alone of each idea that can be bought here, by id (cardGoods). */
  goodsFor: Record<string, number>;
  /** The return route's `card=`, when the buyer just came back from Stripe's page. */
  cardReturn: string | null;
  startCard: (phone: string | null) => Promise<StartCardResult>;
  /** "Most you'll pay" for each idea that can be bought here, at its total on the page; null past the allowance. */
  maxFor: Record<string, number | null>;
};

export type FixScreenProps = {
  roundId: string;
  personId: string;
  personName: string;
  shipByDeadline: string;
  /** The unresolved failed order. */
  order: RoundPageOrder;
  /** The failed order's idea. */
  idea: RoundPageIdea | null;
  /** The next-best idea; null for address failures (they re-offer the same gift) or when none is left. */
  nextBest: RoundPageIdea | null;
  budgetCents: number | null;
  overBudgetPct: number;
  /** What the round's other live orders already hold. */
  committedCents: number;
  /** zinc_order_fee_cents, for the money notice. */
  feeCents: number;
  /** priceCheckNotice(zinc_lookup_cents) */
  priceCheckNotice: string;
  recipient: RecipientAddress;
  buyerAddress: Place | null;
  returnPath: string;
  checkPriceAction: (roundId: string, orderId: string) => Promise<CheckResult>;
  replaceAction: (
    roundId: string,
    orderId: string,
    form: FormData,
  ) => Promise<FixResult>;
  /** The round's occasion kind, for "Skip Nora's birthday"; null when it can't be read. */
  occasionKind: string | null;
  /** "Pick a different gift": only when this is the round's only gift still in play. */
  canPick: boolean;
  /** "Skip": only when no gift in the round is held, being ordered or on its way. */
  canSkip: boolean;
  pickAgainAction: (roundId: string, orderId: string) => Promise<PickAgainResult>;
  skipRoundAction: (roundId: string, shownOrderIds: string[]) => Promise<SkipResult>;
  /** Set for a card buyer; a wallet buyer sees the page as it was before cards. */
  card?: FixCard;
};

const ADDRESS_FAILURES = new Set(["address_withdrawn", "address_rejected"]);

const WHAT_HAPPENED: Record<string, { title: string; body: string }> = {
  price_up: {
    title: "The price went up",
    body: "It cost more than you approved, so we didn't buy it.",
  },
  out_of_stock: {
    title: "It's out of stock",
    body: "The store ran out, so we didn't buy it.",
  },
  too_late: {
    title: "It can't arrive in time any more",
    body: "It wouldn't get there for the day, so we didn't buy it.",
  },
  address_withdrawn: {
    title: "The address isn't shared any more",
    body: "The address it was going to isn't shared now, so we didn't send it.",
  },
  address_rejected: {
    title: "The store couldn't ship to that address",
    body: "The address was refused, so we didn't send it.",
  },
  card_needed: {
    title: "Your card changed or couldn't be charged",
    body: "Nothing was bought.",
  },
  store_cancelled: {
    title: "The store cancelled it",
    body: "The money is back in your Zinc wallet. Choose another gift.",
  },
};
const FAILED_OTHER = {
  title: "The store couldn't take the order",
  body: "Something went wrong at the store, so we didn't buy it.",
};

const CHECK_WORDS: Record<
  Extract<CheckResult, { ok: false }>["error"],
  string
> = {
  once: "The price went up again, so we won't try this one a third time.",
  unavailable: "We can't get today's price for this one.",
  not_allowed: "Checking prices is open to test accounts during the alpha.",
  not_current: "This gift was already sorted out. Reload to see what happened.",
  not_open: "This gift can't be changed now. Reload to see what happened.",
  zinc_off: "Buying is switched off right now, so we didn't check the price.",
  session: "Your session ended. Sign in again.",
  bad_form: "That didn't work. Reload and try again.",
};

/** Errors that leave the page as it was, so the buyer can act and try again. */
const STAY = new Set([
  "busy",
  "session",
  "no_address",
  "price_changed",
  "needs_confirmation",
]);

/** One thing the buyer can buy here: a gift, at a total, to somewhere. */
type Target = {
  key: string;
  ideaId: string;
  totalCents: number;
  shownTotalCents?: number;
  shipTo?: ShipChoice;
  /** A card buyer's "Most you'll pay" for it, sent back so nothing dearer is bought (AC-4). */
  maxCents?: number | null;
};

export function FixScreen(p: FixScreenProps) {
  const { roundId, order, idea, budgetCents, personName } = p;
  const failure = order.failureType ?? "failed";
  const words = WHAT_HAPPENED[failure] ?? FAILED_OTHER;
  const addressFailure = ADDRESS_FAILURES.has(failure);

  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, startChecking] = useTransition();
  const [pendingOver, setPendingOver] = useState<Target | null>(null);
  // The target "Yes, pick it" was said to.
  const [overOk, setOverOk] = useState<string | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);
  const [error, setError] = useState<Extract<FixResult, { ok: false }> | null>(
    null,
  );
  const [thrown, setThrown] = useState(false);
  const [other, setOther] = useState(false);
  const [saveToPerson, setSaveToPerson] = useState(false);
  const [buying, startBuying] = useTransition();
  const maxFor = (ideaId: string) => p.card?.maxFor[ideaId] ?? null;
  // A card buyer's newer, higher "Most you'll pay" per target, once the server said so (AC-4).
  const [maxNow, setMaxNow] = useState<Record<string, number>>({});
  const card = p.card;
  const maxOf = (t: Target) => maxNow[t.key] ?? t.maxCents ?? null;

  if (result) return <Outcome result={result} roundId={roundId} />;

  const fitFor = (totalCents: number) =>
    classifyTotal(p.committedCents + totalCents, budgetCents, p.overBudgetPct);

  function send(t: Target, over: boolean) {
    const form = new FormData();
    form.set("ideaId", t.ideaId);
    if (t.shownTotalCents !== undefined)
      form.set("shownTotalCents", String(t.shownTotalCents));
    if (over) form.set("over", "1");
    const max = maxOf(t);
    if (card && max !== null) form.set("shownMaxCents", String(max));
    if (t.shipTo) putShipTo(form, t.shipTo);
    setError(null);
    setThrown(false);
    startBuying(async () => {
      let r: FixResult;
      try {
        r = await p.replaceAction(roundId, order.id, form);
      } catch {
        setThrown(true);
        return;
      }
      if (!r.ok && r.error === "needs_confirmation") {
        // Over a budget the page didn't know about: ask first, as for any other.
        setOverOk(null);
        setPendingOver(t);
        return;
      }
      if (!r.ok && r.error === "price_changed" && card && r.neverMoreThanCents !== undefined) {
        const higher = r.neverMoreThanCents;
        setMaxNow((m) => ({ ...m, [t.key]: higher }));
      } else if (!r.ok && r.error === "price_changed") setCheck(null);
      if (!r.ok && STAY.has(r.error)) setError(r);
      else setResult(r);
    });
  }

  function attempt(t: Target) {
    const fit = fitFor(t.totalCents);
    if (fit === "dropped") return;
    if (fit === "over" && overOk !== t.key) {
      setPendingOver(t);
      return;
    }
    send(t, fit === "over" || overOk === t.key);
  }

  /** The button for a target: its own words, or "Buy anyway" once the buyer said yes. */
  function buyButton(t: Target, label: string, variant?: "outline") {
    const fit = fitFor(t.totalCents);
    if (fit === "dropped" && budgetCents !== null) {
      return (
        <p className="text-[13px] font-semibold text-destructive">
          {`Over the most you allowed (${money(overBudgetLimitCents(budgetCents, p.overBudgetPct))})`}
        </p>
      );
    }
    return (
      <Button
        type="button"
        variant={variant}
        className="w-full"
        disabled={buying}
        aria-busy={buying}
        onClick={() => attempt(t)}
      >
        {overOk === t.key ? `Buy anyway · ${money(t.totalCents)}` : label}
      </Button>
    );
  }

  function checkPrice() {
    startChecking(async () => {
      try {
        setCheck(await p.checkPriceAction(roundId, order.id));
      } catch {
        setCheck({ ok: false, error: "bad_form" });
      }
    });
  }

  /** A card that couldn't be charged, with a card saved now (3b, 3c): today's price, then Buy again. */
  function cardNeededBuy(c: FixCard, i: RoundPageIdea) {
    const saved = <SavedCard start={() => c.startCard(null)} />;
    const askFirst = i.livePrice && (check === null || (!check.ok && (check.error === "session" || check.error === "bad_form")));
    if (askFirst) {
      return (
        <div className="flex flex-col gap-2">
          {saved}
          {check && !check.ok && (
            <p role="alert" className="text-[13px] text-destructive">
              {CHECK_WORDS[check.error]}
            </p>
          )}
          <p role="note" className="rounded-lg bg-warning-soft px-2.5 py-2 text-[13px] text-warning">
            {p.priceCheckNotice}
          </p>
          <Button type="button" variant="outline" className="w-full" disabled={checking} aria-busy={checking} onClick={checkPrice}>
            Check today&apos;s price
          </Button>
        </div>
      );
    }
    // Checked, or it can't be: a gift that can't be priced today keeps its saved estimate, still capped.
    if (check && !check.ok && check.error !== "unavailable") {
      return (
        <p role="status" className="text-[15px]">
          {CHECK_WORDS[check.error]}
        </p>
      );
    }
    const today = check?.ok ? check : null;
    const total = today ? today.newCents : i.totalCents;
    let goods = c.goodsFor[i.id];
    if (today) {
      try {
        // Exact: each whole charge comes from one goods total.
        goods = goodsCapCents(today.newCents, c.fees);
      } catch {
        goods = total;
      }
    }
    const target: Target = { key: "same", ideaId: i.id, totalCents: total, maxCents: today ? (today.maxCents ?? null) : maxFor(i.id) };
    const max = maxOf(target);
    return (
      <div className="flex flex-col gap-2">
        <ul aria-label="What it costs" className="flex flex-col gap-1.5 rounded-xl border border-border p-3 text-[15px]">
          <CostLine label={today ? "Today's price, shipping and tax" : "Price, shipping and tax"} value={money(goods)} />
          <CostLine
            label={c.fee.label}
            value={money(total - goods)}
            extra={<FeeInfo fee={c.fee} gifts={1} goodsCents={goods} totalCents={total} capGoodsCents={null} maxChargeCents={max} />}
          />
          <CostLine label="Estimated total" value={`About ${money(total)}`} strong />
          {max !== null && <CostLine label="Most you'll pay" value={money(max)} strong />}
        </ul>
        {saved}
        <CardMoneyNotice feeLabel={c.fee.label} />
        {buyButton(target, `Buy again · about ${money(total)}`)}
      </div>
    );
  }

  const seeAll = (
    <Button asChild variant="outline">
      <Link href={`/rounds/${roundId}`}>See all ideas</Link>
    </Button>
  );

  const linkCls =
    "inline-flex min-h-11 items-center text-[15px] text-primary underline underline-offset-[3px]";

  // A card buyer buys here only with paying by card on and a card saved; otherwise the page
  // offers Add a card, or says buying is paused (AC-12).
  const canBuyHere = !card || (card.on && card.hasCard);
  const cardNeeded = failure === "card_needed";

  return (
    <>
      <section className="flex flex-col gap-2" aria-labelledby="fix-what">
        {cardNeeded ? (
          <div className="rounded-xl bg-warning-soft p-3 text-[15px]">
            <h2 id="fix-what" className="font-bold text-warning">
              {words.title}
            </h2>
            <p>{`${words.body} Choose by ${chooseBy(p.shipByDeadline)} to still arrive in time.`}</p>
          </div>
        ) : (
          <>
            <h2 id="fix-what" className="text-[17px] font-bold">
              {words.title}
            </h2>
            <p className="text-[15px]">{`${words.body} Choose by ${chooseBy(p.shipByDeadline)} to still arrive in time.`}</p>
          </>
        )}
        {idea && (
          <div className="flex items-start gap-3 rounded-xl border border-border p-3">
            <IdeaPhoto url={idea.imageUrl} title={idea.title} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                {idea.title}
              </span>
              {failure === "price_up" && check?.ok ? (
                <span className="flex gap-2 text-[15px] tabular-nums">
                  <span className="text-muted-foreground line-through">
                    {money(check.oldCents)}
                  </span>
                  <span className="font-semibold">{`Now ${money(check.newCents)}`}</span>
                </span>
              ) : cardNeeded && canBuyHere ? (
                idea.arriveBy && <span className="text-[13px] text-muted-foreground">{`Arrives by ${shortDate(idea.arriveBy)}`}</span>
              ) : (
                <span className="text-[13px] tabular-nums text-muted-foreground">{`You approved ${money(idea.totalCents)}`}</span>
              )}
            </span>
            {card && cardNeeded && canBuyHere && (
              <span className="ml-auto flex-none text-[15px] font-semibold tabular-nums">{money(card.goodsFor[idea.id])}</span>
            )}
          </div>
        )}
      </section>

      {card ? (
        canBuyHere && !cardNeeded && <CardMoneyNotice feeLabel={card.fee.label} />
      ) : (
        <MoneyNotice feeCents={p.feeCents} />
      )}

      {card && <CardReturnNotice status={card.cardReturn} />}
      {card && !card.on && <BuyingPaused />}
      {card?.on && !card.hasCard && (
        <AddCard start={card.startCard} needsPhone={card.needsPhone}>
          <p className="text-center text-[13px] text-muted-foreground">
            Then you&apos;ll come back here and tap Buy again. <b>Adding a card doesn&apos;t buy anything.</b>
          </p>
        </AddCard>
      )}
      {card && canBuyHere && cardNeeded && idea && cardNeededBuy(card, idea)}

      {canBuyHere && failure === "price_up" && idea && !idea.livePrice && (
        <p role="status" className="text-[15px]">
          We can&apos;t check today&apos;s price for this one.
        </p>
      )}

      {canBuyHere && failure === "price_up" && idea?.livePrice && (
        <div className="flex flex-col gap-2">
          {check === null ||
          (!check.ok &&
            (check.error === "session" || check.error === "bad_form")) ? (
            <>
              {check && !check.ok && (
                <p role="alert" className="text-[13px] text-destructive">
                  {CHECK_WORDS[check.error]}
                </p>
              )}
              <p
                role="note"
                className="rounded-lg bg-warning-soft px-2.5 py-2 text-[13px] text-warning"
              >
                {p.priceCheckNotice}
              </p>
              <Button
                type="button"
                className="w-full"
                disabled={checking}
                aria-busy={checking}
                onClick={checkPrice}
              >
                Check today&apos;s price
              </Button>
            </>
          ) : check.ok ? (
            buyButton(
              {
                key: "same",
                ideaId: idea.id,
                totalCents: check.newCents,
                shownTotalCents: check.newCents,
                maxCents: check.maxCents ?? null,
              },
              `Buy at about ${money(check.newCents)}`,
            )
          ) : (
            <p role="status" className="text-[15px]">
              {CHECK_WORDS[check.error]}
            </p>
          )}
        </div>
      )}

      {canBuyHere && addressFailure && idea && (
        <section className="flex flex-col gap-2" aria-labelledby="fix-where">
          <h2 id="fix-where" className="text-[17px] font-bold">
            Send it somewhere else
          </h2>
          {p.buyerAddress ? (
            buyButton(
              {
                key: "buyer",
                ideaId: idea.id,
                totalCents: idea.totalCents,
                maxCents: maxFor(idea.id),
                shipTo: { kind: "buyer" },
              },
              `Ship it to me · buy for about ${money(idea.totalCents)}`,
            )
          ) : (
            <Link href={myAddressHref(p.returnPath)} className={linkCls}>
              Add your address
            </Link>
          )}
          {p.recipient.kind === "none" && (
            <Link
              href={personAddressHref(p.personId, p.returnPath)}
              className={linkCls}
            >
              {`Add ${personName}'s address`}
            </Link>
          )}
          {p.recipient.kind === "own" &&
            buyButton(
              {
                key: "recipient",
                ideaId: idea.id,
                totalCents: idea.totalCents,
                maxCents: maxFor(idea.id),
                shipTo: { kind: "recipient" },
              },
              `Ship to ${personName}'s address in ${place(p.recipient)} · buy for about ${money(idea.totalCents)}`,
              "outline",
            )}
          {other ? (
            <OtherAddressForm
              start={EMPTY_ADDRESS}
              personName={personName}
              canSave={p.recipient.kind !== "shared"}
              saveToPerson={saveToPerson}
              onSaveToPerson={setSaveToPerson}
              submitLabel={`Ship it here · buy for about ${money(idea.totalCents)}`}
              onUse={(address) =>
                attempt({
                  key: "other",
                  ideaId: idea.id,
                  totalCents: idea.totalCents,
                  maxCents: maxFor(idea.id),
                  shipTo: {
                    kind: "other",
                    address,
                    saveToPerson: p.recipient.kind !== "shared" && saveToPerson,
                  },
                })
              }
              onCancel={() => setOther(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOther(true)}
            >
              Another address
            </Button>
          )}
        </section>
      )}

      {canBuyHere && !addressFailure && !cardNeeded && p.nextBest && (
        <section className="flex flex-col gap-2" aria-labelledby="fix-next">
          <h2 id="fix-next" className="text-[17px] font-bold">
            Or the next-best idea
          </h2>
          <div className="flex items-start gap-3 rounded-xl border border-border p-3">
            <IdeaPhoto url={p.nextBest.imageUrl} title={p.nextBest.title} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                {p.nextBest.title}
              </span>
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {[
                  money(p.nextBest.totalCents),
                  p.nextBest.arriveBy
                    ? `by ${shortDate(p.nextBest.arriveBy)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
          {buyButton(
            {
              key: `next:${p.nextBest.id}`,
              ideaId: p.nextBest.id,
              totalCents: p.nextBest.totalCents,
              maxCents: maxFor(p.nextBest.id),
            },
            "Buy this instead",
            failure === "price_up" ? "outline" : undefined,
          )}
        </section>
      )}

      {thrown && (
        <p role="alert" className="text-[13px] text-destructive">
          {UNKNOWN}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-1 text-[13px] text-destructive"
        >
          <span className="font-semibold">{outcomeWords(error).title}</span>
          <span>
            {error.error === "no_address"
              ? "Check the address, or choose another."
              : error.error === "price_changed" && card && error.neverMoreThanCents !== undefined
                ? `The most you'll pay is now ${money(error.neverMoreThanCents)}. Nothing was bought. Tap Buy again to agree to it.`
                : outcomeWords(error).body}
          </span>
        </div>
      )}

      {/* "Pick a different gift" opens every idea, so "See all ideas" only when it can't. */}
      {!p.canPick && seeAll}
      <WaysOut
        roundId={roundId}
        orderId={order.id}
        giftTitle={idea?.title ?? order.title}
        failureType={order.failureType}
        personName={p.personName}
        occasionKind={p.occasionKind}
        canPick={p.canPick}
        canSkip={p.canSkip}
        pickAction={p.pickAgainAction}
        skipAction={p.skipRoundAction}
        shownOrderIds={[order.id]}
      />

      <OverBudgetSheet
        open={pendingOver !== null}
        totalCents={p.committedCents + (pendingOver?.totalCents ?? 0)}
        budgetCents={budgetCents}
        yesLabel={
          pendingOver?.key === "other"
            ? `Buy anyway · ${money(pendingOver.totalCents)}`
            : undefined
        }
        onYes={() => {
          if (!pendingOver) return;
          setPendingOver(null);
          // "Another address" was its own Buy: send it now. Elsewhere the button now reads "Buy anyway".
          if (pendingOver.key === "other") send(pendingOver, true);
          else setOverOk(pendingOver.key);
        }}
        onKeep={() => setPendingOver(null)}
      />
    </>
  );
}
