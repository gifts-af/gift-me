"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { classifyTotal, overBudgetLimitCents } from "@gifts-af/core";
import { storeName } from "@gifts-af/core/store-page/link";
import { PageTitle } from "@/components/app-shell/page-frame";
import { IdeaPhoto } from "@/components/idea-photo";
import { shortDate } from "@/lib/occasion-format";
import { storeLabel } from "@/lib/store-label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FeeSheet, RoundPageIdea } from "@/modules/concierge";
import { money } from "@/app/people/[id]/money";
import { listPriceNote } from "../round-screen";
import { MoneyNotice, Outcome, UNKNOWN, outcomeWords, type BuyResult } from "../../outcome";
import { AddCard, BuyingPaused, CardMoneyNotice, CardReturnNotice, CostLine, FeeInfo, SavedCard, type StartCardResult } from "../../card-ui";
import {
  EMPTY_ADDRESS,
  OtherAddressForm,
  myAddressHref,
  personAddressHref,
  place,
  putShipTo,
  shipsToLabel,
  type Place,
  type RecipientAddress,
  type ShipChoice,
} from "../../ship-to";

export type { BuyResult };

/**
 * A card buyer's page (mock-ups 1a to 1d): each idea's total is its whole charge, fee included.
 * Without a card it offers Add a card (and asks for the phone there when none is saved); with
 * one, "Saved card" and Buy now. Paused (connect_enabled off): nothing to add or buy.
 */
export type ConfirmCard = {
  on: boolean;
  hasCard: boolean;
  needsPhone: boolean;
  fee: FeeSheet;
  /** The picks' goods caps together, for the (i) breakdown's "if the price goes up"; null past the allowance. */
  capGoodsCents: number | null;
  /** The return route's `card=`, when the buyer just came back from Stripe's page. */
  cardReturn: string | null;
  /** Each pick's price, shipping and tax alone, by idea id (cardGoods). */
  goodsFor: Record<string, number>;
  /** Leaves for Stripe's page and comes back to this gift; never buys. */
  startCard: (phone: string | null) => Promise<StartCardResult>;
};

// The confirm page (ALL-29 AC-2, AC-4, AC-8, AC-10, AC-11, AC-12b, AC-18, AC-19): everything that
// will happen, then one button that buys. Loading it never buys (AC-4a). Whether it's over the
// budget is worked out here from the round, never from the link: "Buy anyway" is the deliberate
// choice, and only it sends `over` (the server checks the budget again either way).

export type ConfirmScreenProps = {
  roundId: string;
  personId: string;
  personName: string;
  /** The picks, in rank order. */
  ideas: RoundPageIdea[];
  /** Why nothing can be bought here ("These ideas were replaced", "Already ordered: …"), or null. */
  blocked: string | null;
  budgetCents: number | null;
  overBudgetPct: number;
  /** zinc_order_fee_cents, included in each idea's total. */
  feeCents: number;
  /** capsFor's "never more than"; null when the picks are past the allowance. */
  neverMoreThanCents: number | null;
  /** zinc_gift_message_max_chars */
  giftMessageMax: number;
  /** The Zinc balance, or null when it couldn't be read. */
  balanceCents: number | null;
  recipient: RecipientAddress;
  buyerAddress: Place | null;
  /** This page, for the address forms' `next`. */
  returnPath: string;
  buyAction: (roundId: string, form: FormData) => Promise<BuyResult>;
  /** Set for a card buyer; a wallet buyer sees the page as it was before cards. */
  card?: ConfirmCard;
};

/** Errors that leave the page as it was, with the button, so the buyer can act and try again. */
const STAY = new Set(["busy", "needs_confirmation", "gift_message_too_long", "no_address", "session", "price_changed", "no_card"]);

function storeOf(i: RoundPageIdea): string | null {
  if (i.productUrl) {
    const name = storeName(i.productUrl);
    if (name) return storeLabel(name);
  }
  return storeLabel(i.retailer);
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <li className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
    </li>
  );
}

export function ConfirmScreen(p: ConfirmScreenProps) {
  const { roundId, ideas, budgetCents, feeCents, personName } = p;
  const total = ideas.reduce((sum, i) => sum + i.totalCents, 0);
  const fit = classifyTotal(total, budgetCents, p.overBudgetPct);

  const [choice, setChoice] = useState<ShipChoice>({ kind: "recipient" });
  const [shipOpen, setShipOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  // The server found it over a budget set since the page loaded (needs_confirmation).
  const [overNow, setOverNow] = useState(false);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [error, setError] = useState<Extract<BuyResult, { ok: false }> | null>(null);
  // The action threw: a purchase may have gone through, so the page says to check first.
  const [thrown, setThrown] = useState(false);
  const [pending, startTransition] = useTransition();
  // A card buyer's "Most you'll pay": the server's newer, higher figure once it said so (AC-4).
  const [maxNow, setMaxNow] = useState<number | null>(null);
  const card = p.card;
  const neverMoreThan = maxNow ?? p.neverMoreThanCents;

  if (result) {
    const gifts = ideas.length === 1 ? "gift" : "gifts";
    return (
      <>
        {/* Refused, nothing was bought; either way it no longer asks. */}
        <PageTitle>{result.ok ? `Your ${gifts} for ${personName}` : `${ideas.length === 1 ? "Gift" : "Gifts"} for ${personName}`}</PageTitle>
        <Outcome result={result} roundId={roundId} />
      </>
    );
  }

  const title = <PageTitle>{ideas.length === 1 ? `Buy this for ${personName}?` : `Buy these ${ideas.length} gifts for ${personName}?`}</PageTitle>;

  const seeAll = (
    <Button asChild variant="outline">
      <Link href={`/rounds/${roundId}`}>See all ideas</Link>
    </Button>
  );

  const cards = (
    <ul className="flex flex-col gap-2">
      {ideas.map((i) => (
        <li key={i.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
          <IdeaPhoto url={i.imageUrl} title={i.title} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{i.title}</span>
            <span className="text-[13px] text-muted-foreground">
              {[storeOf(i), listPriceNote(i), i.arriveBy ? `Arrives by ${shortDate(i.arriveBy)}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="flex-none text-[15px] font-semibold tabular-nums">{money(card ? card.goodsFor[i.id] : i.totalCents)}</span>
        </li>
      ))}
    </ul>
  );

  if (p.blocked) {
    return (
      <>
        {title}
        <p role="status" className="rounded-xl border border-border p-3 text-[15px] font-semibold">
          {p.blocked}
        </p>
        {cards}
        {seeAll}
      </>
    );
  }

  const over = fit === "over" || overNow;
  const buyable = fit !== "dropped" && p.neverMoreThanCents !== null;
  const label = over ? `Buy anyway · ${money(total)}` : `Buy now · about ${money(total)}`;

  function buy() {
    const form = new FormData();
    form.set("ideas", ideas.map((i) => i.id).join(","));
    if (note.trim()) form.set("note", note);
    // Only from this button, in its "Buy anyway" state.
    if (over) form.set("over", "1");
    // What the page showed, so the server buys only while that's still the most (AC-4).
    if (card && neverMoreThan !== null) form.set("shownMaxCents", String(neverMoreThan));
    putShipTo(form, choice);
    setError(null);
    setThrown(false);
    startTransition(async () => {
      let r: BuyResult;
      try {
        r = await p.buyAction(roundId, form);
      } catch {
        setThrown(true);
        return;
      }
      if (!r.ok && r.error === "needs_confirmation") setOverNow(true);
      if (!r.ok && r.error === "price_changed" && r.neverMoreThanCents !== undefined) setMaxNow(r.neverMoreThanCents);
      if (!r.ok && STAY.has(r.error)) setError(r);
      else setResult(r);
    });
  }

  const n = ideas.length;
  // A card buyer's goods alone.
  const goods = card ? ideas.reduce((sum, i) => sum + card.goodsFor[i.id], 0) : 0;
  const paused = card !== undefined && !card.on;
  return (
    <>
      {title}
      {cards}

      {card ? (
        <ul aria-label="What it costs" className="flex flex-col gap-1.5 rounded-xl border border-border p-3 text-[15px]">
          <CostLine label="Price, shipping and tax" value={money(goods)} />
          <CostLine
            label={card.fee.label}
            value={money(total - goods)}
            extra={
              <FeeInfo
                fee={card.fee}
                gifts={n}
                goodsCents={goods}
                totalCents={total}
                capGoodsCents={maxNow === null ? card.capGoodsCents : null}
                maxChargeCents={neverMoreThan}
              />
            }
          />
          <CostLine label="Estimated total" value={`About ${money(total)}`} strong />
          {neverMoreThan !== null && <CostLine label="Most you'll pay" value={money(neverMoreThan)} strong />}
        </ul>
      ) : (
        <ul aria-label="What it costs" className="flex flex-col gap-1.5 rounded-xl border border-border p-3 text-[15px]">
          <Line label="Price, shipping and tax" value={money(total - feeCents * n)} />
          <Line label="Zinc's order fee" value={n === 1 ? money(feeCents) : `${n} × ${money(feeCents)}`} />
          <Line label="Estimated total" value={`About ${money(total)}`} strong />
          {p.neverMoreThanCents !== null && <Line label="Never more than" value={money(p.neverMoreThanCents)} />}
        </ul>
      )}

      {fit === "over" && budgetCents !== null && (
        <p className="rounded-xl bg-warning-soft p-3 text-[15px] font-semibold text-warning">
          {`${money(total - budgetCents)} over ${personName}'s ${money(budgetCents)} budget.`}
        </p>
      )}
      {fit === "dropped" && budgetCents !== null && (
        <p className="rounded-xl bg-warning-soft p-3 text-[15px] font-semibold text-destructive">
          {`Over the most you allowed (${money(overBudgetLimitCents(budgetCents, p.overBudgetPct))})`}
        </p>
      )}

      {!paused && (
      <div className="flex flex-col rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setShipOpen(true)}
          className="flex min-h-12 items-center justify-between gap-3 px-3 text-left text-[15px]"
        >
          <span className="text-muted-foreground">Ships to</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{shipsToLabel(choice, personName, p.recipient, p.buyerAddress)}</span>
        </button>
        <div className="border-t border-border">
          {noteOpen ? (
            <label className="flex flex-col gap-1.5 p-3">
              <span className="text-[15px] font-semibold">Gift note (optional)</span>
              <textarea
                value={note}
                maxLength={p.giftMessageMax}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 text-base"
              />
              <span className="text-right text-[13px] tabular-nums text-muted-foreground">{`${note.length} / ${p.giftMessageMax}`}</span>
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left text-[15px]"
            >
              <span className="text-muted-foreground">Gift note</span>
              <span className="text-primary">Add</span>
            </button>
          )}
        </div>
      </div>
      )}

      {card && <CardReturnNotice status={card.cardReturn} />}
      {paused && <BuyingPaused />}
      {card?.on && !card.hasCard && (
        <AddCard start={card.startCard} needsPhone={card.needsPhone}>
          <p className="text-center text-[13px] text-muted-foreground">
            Opens Stripe&apos;s secure card page, then brings you back here. <b>Nothing is bought until you tap Buy now.</b>
          </p>
        </AddCard>
      )}
      {card?.on && card.hasCard && <SavedCard start={() => card.startCard(null)} sub="Charged only when you tap Buy now." />}
      {card ? (
        card.on && card.hasCard && <CardMoneyNotice feeLabel={card.fee.label} />
      ) : (
        <MoneyNotice feeCents={feeCents} balanceCents={p.balanceCents} />
      )}

      {thrown && (
        <p role="alert" className="text-[13px] text-destructive">
          {UNKNOWN}
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-col gap-1 text-[13px] text-destructive">
          <span className="font-semibold">{outcomeWords(error).title}</span>
          {error.error === "price_changed" && maxNow !== null ? (
            <span>{`The most you'll pay is now ${money(maxNow)}. Nothing was bought. Tap Buy now again to agree to it.`}</span>
          ) : error.error === "no_address" ? (
            <AddressFix choice={choice} personId={p.personId} personName={personName} next={p.returnPath} />
          ) : error.error === "gift_message_too_long" ? (
            <span>{`Keep it under ${p.giftMessageMax} characters.`}</span>
          ) : (
            <span>{outcomeWords(error).body}</span>
          )}
        </div>
      )}

      {buyable && (!card || (card.on && card.hasCard)) && (
        <Button type="button" className="w-full" disabled={pending} aria-busy={pending} onClick={buy}>
          {label}
        </Button>
      )}
      {paused ? (
        <Button asChild variant="outline">
          <Link href={`/rounds/${roundId}`}>See the other ideas</Link>
        </Button>
      ) : (
        <Button asChild variant="link" className="self-center">
          <Link href={`/rounds/${roundId}`}>See the other ideas</Link>
        </Button>
      )}

      <ShipToDialog
        open={shipOpen}
        onOpenChange={setShipOpen}
        choice={choice}
        onChoose={setChoice}
        personId={p.personId}
        personName={personName}
        recipient={p.recipient}
        buyerAddress={p.buyerAddress}
        returnPath={p.returnPath}
      />
    </>
  );
}

/** What to do about a missing address, for the choice that needed one. */
function AddressFix({ choice, personId, personName, next }: { choice: ShipChoice; personId: string; personName: string; next: string }) {
  const cls = "inline-flex min-h-11 items-center text-primary underline underline-offset-[3px]";
  if (choice.kind === "recipient")
    return (
      <Link href={personAddressHref(personId, next)} className={cls}>
        {`Add ${personName}'s address`}
      </Link>
    );
  if (choice.kind === "buyer")
    return (
      <Link href={myAddressHref(next)} className={cls}>
        Add your address
      </Link>
    );
  return <span>Check the address under Ships to.</span>;
}

/** ALL-41's "Where it goes": the recipient (default), me, or another address. */
function ShipToDialog({
  open,
  onOpenChange,
  choice,
  onChoose,
  personId,
  personName,
  recipient,
  buyerAddress,
  returnPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: ShipChoice;
  onChoose: (c: ShipChoice) => void;
  personId: string;
  personName: string;
  recipient: RecipientAddress;
  buyerAddress: Place | null;
  returnPath: string;
}) {
  const [kind, setKind] = useState<ShipChoice["kind"]>(choice.kind);
  const [saveToPerson, setSaveToPerson] = useState(recipient.kind === "none");
  const start = choice.kind === "other" ? choice.address : EMPTY_ADDRESS;
  const link = "inline-flex min-h-11 items-center text-[13px] text-primary underline underline-offset-[3px]";

  const option = (k: ShipChoice["kind"], title: string, sub: React.ReactNode, disabled = false) => (
    <label
      className={cn(
        "flex min-h-11 items-start gap-3 rounded-xl border border-border p-3",
        disabled ? "opacity-60" : "cursor-pointer",
        kind === k && "border-primary ring-1 ring-primary",
      )}
    >
      <input
        type="radio"
        name="ship-to"
        value={k}
        checked={kind === k}
        disabled={disabled}
        onChange={() => setKind(k)}
        aria-label={title}
        className="mt-1 size-5 flex-none accent-primary"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{sub}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setKind(choice.kind);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Where should it go?</DialogTitle>
          <DialogDescription>Choose where the gift ships.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Ship to" className="flex flex-col gap-2">
          {option(
            "recipient",
            `${personName}'s address`,
            recipient.kind === "shared" ? (
              `Shared through their list · ${place(recipient)}`
            ) : recipient.kind === "own" ? (
              place(recipient)
            ) : (
              <Link href={personAddressHref(personId, returnPath)} className={link}>
                {`Not saved yet. Add ${personName}'s address`}
              </Link>
            ),
            recipient.kind === "none",
          )}
          {option(
            "buyer",
            "My address",
            buyerAddress ? (
              `${place(buyerAddress)} · from Settings`
            ) : (
              <Link href={myAddressHref(returnPath)} className={link}>
                Not saved yet. Add your address
              </Link>
            ),
            buyerAddress === null,
          )}
          {option("other", "Another address", "A party, an office, a neighbour")}
        </div>
        {kind === "other" ? (
          <OtherAddressForm
            start={start}
            personName={personName}
            canSave={recipient.kind !== "shared"}
            saveToPerson={saveToPerson}
            onSaveToPerson={setSaveToPerson}
            submitLabel="Ship here"
            onUse={(address) => {
              onChoose({ kind: "other", address, saveToPerson: recipient.kind !== "shared" && saveToPerson });
              onOpenChange(false);
            }}
            onCancel={() => setKind(choice.kind)}
          />
        ) : (
          <Button
            type="button"
            onClick={() => {
              onChoose(kind === "buyer" ? { kind: "buyer" } : { kind: "recipient" });
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
