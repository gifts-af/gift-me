"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { topUpFeeLabel } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FeeSheet } from "@/modules/concierge";

// The pieces a card buyer sees on the buy, fix and Settings pages (mock-ups
// design/mockups/ALL-98-card-payments.html, approved 2026-11-27): Add a card, the saved card,
// the money notice, the phone asked next to Add a card, and the GiftsAF fee's (i) breakdown.
// Adding a card leaves for Stripe's own page and comes back; it never buys anything.

/** What leaving for Stripe's card page came to: its address, or why not. */
export type StartCardResult = { ok: true; url: string } | { ok: false; error: "off" | "bad_phone" | "not_yours" | "session" | "unavailable" };

const START_WORDS: Record<Extract<StartCardResult, { ok: false }>["error"], string> = {
  off: "Buying is paused right now, so you can't add a card.",
  bad_phone: "Enter a 10-digit phone number.",
  not_yours: "That didn't go through. Reload and try again.",
  session: "Your session ended. Sign in again.",
  unavailable: "We couldn't open the card page. Try again in a minute.",
};

/**
 * What the page says after coming back from Stripe's page (the return route's `card=`). Only the
 * page a visit lands on shows it: "cancelled" on the gift it started from, the rest on Settings.
 */
export const CARD_RETURN_WORDS: Record<string, string> = {
  cancelled: "No card was saved. Nothing was bought.",
  used: "That card page was already used. If you added a card, it's saved below.",
  not_yours: "That card page wasn't yours, so no card was saved.",
  unavailable: "Adding a card isn't switched on here. No card was saved.",
  error: "Something went wrong saving your card. Check below before trying again.",
};

/** The `card=` notice for a page, or nothing for a value it doesn't know. */
export function CardReturnNotice({ status }: { status: string | null | undefined }) {
  const text = status ? CARD_RETURN_WORDS[status] : undefined;
  if (!text) return null;
  return (
    <p role="status" className="rounded-xl border border-border p-3 text-[15px]">
      {text}
    </p>
  );
}

/** Leaves for Stripe's page through `start`, so a button can say what went wrong instead. */
function useStartCard(start: () => Promise<StartCardResult>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function go() {
    setError(null);
    startTransition(async () => {
      let r: StartCardResult;
      try {
        r = await start();
      } catch {
        r = { ok: false, error: "unavailable" };
      }
      if (r.ok) window.location.assign(r.url);
      else setError(START_WORDS[r.error]);
    });
  }
  return { error, pending, go };
}

/** "Add a card", with what it does underneath and, when the account has none, the phone (AC-17). */
export function AddCard({
  start,
  needsPhone,
  variant = "default",
  children,
}: {
  start: (phone: string | null) => Promise<StartCardResult>;
  needsPhone: boolean;
  variant?: "default" | "outline";
  /** The line under the button. */
  children?: React.ReactNode;
}) {
  const [phone, setPhone] = useState("");
  const { error, pending, go } = useStartCard(() => start(needsPhone ? phone : null));
  return (
    <>
      {needsPhone && <PhoneField value={phone} onChange={setPhone} hint="Stores need one for delivery. Asked once." />}
      <Button type="button" variant={variant} className="w-full" disabled={pending} aria-busy={pending} onClick={go}>
        <CreditCard aria-hidden="true" />
        Add a card
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {children}
    </>
  );
}

/** The buyer's phone: Zinc needs one on every order. */
export function PhoneField({ value, onChange, hint, id = "card-phone" }: { value: string; onChange: (v: string) => void; hint: string; id?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[15px] font-semibold">
        Your phone
      </Label>
      <span id={`${id}-hint`} className="text-[13px] text-muted-foreground">
        {hint}
      </span>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(555) 123-4567"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className="num"
      />
    </div>
  );
}

/** "Saved card", with Change, which opens Stripe's page again to replace it. */
export function SavedCard({ start, sub }: { start: () => Promise<StartCardResult>; sub?: string }) {
  const { error, pending, go } = useStartCard(start);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2.5 text-[15px]">
        <span aria-hidden="true" className="flex size-[22px] flex-none items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground">
          ✓
        </span>
        <span className="flex min-w-0 flex-col">
          <b>Saved card</b>
          {sub && <span className="text-[13px] text-muted-foreground">{sub}</span>}
        </span>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={go}
          aria-label="Change card"
          className="ml-auto inline-flex min-h-11 items-center text-[14px] font-semibold text-primary underline underline-offset-[3px] disabled:opacity-45"
        >
          Change
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The money notice by a card buyer's Buy button (decision 53): no Zinc, no balance. */
export function CardMoneyNotice({ feeLabel }: { feeLabel: string }) {
  return (
    <div role="note" className="flex flex-col gap-1 rounded-lg bg-warning-soft px-2.5 py-2 text-[13px] text-warning">
      <span>{`Each gift costs its price plus the ${feeLabel}, charged to your card.`}</span>
      <span>This is a real purchase and can&apos;t be undone once placed.</span>
    </div>
  );
}

/** "$1.00", "$0.65": the breakdown always shows cents, so its parts line up. */
function cents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

export type FeeFigures = {
  fee: FeeSheet;
  /** How many gifts the figures are for. */
  gifts: number;
  /** Price, shipping and tax, all gifts together. */
  goodsCents: number;
  /** The whole charge at today's price, all gifts together. */
  totalCents: number;
  /** The goods caps together and the most the card can be charged, when known. */
  capGoodsCents: number | null;
  maxChargeCents: number | null;
};

/** The GiftsAF fee line's (i) button and its breakdown: a sheet on a phone, a dialog on a computer. */
export function FeeInfo(f: FeeFigures) {
  const [open, setOpen] = useState(false);
  const n = f.gifts;
  const fixed = (f.fee.zincFeeCents + f.fee.aiCents + f.fee.runningCents) * n;
  const feeTotal = f.totalCents - f.goodsCents;
  const cardFee = feeTotal - fixed;
  const times = (c: number) => (n === 1 ? cents(c) : `${n} × ${cents(c)}`);
  const atCap =
    f.capGoodsCents !== null && f.maxChargeCents !== null && f.maxChargeCents > f.totalCents
      ? { goods: f.capGoodsCents, cardFee: f.maxChargeCents - f.capGoodsCents - fixed, max: f.maxChargeCents }
      : null;
  const rows: { name: string; why: string; value: string }[] = [
    { name: "Ordering", why: "placing it with the store", value: times(f.fee.zincFeeCents) },
    { name: "AI suggestions", why: "finding ideas, including ones nobody picked", value: times(f.fee.aiCents) },
    { name: "Running GiftsAF", why: "website and email", value: times(f.fee.runningCents) },
    {
      name: "Card fee",
      why: `what the card company charges: ${topUpFeeLabel(f.fee.cardFeeBps, f.fee.cardFeeFixedCents)} of ${n === 1 ? cents(f.totalCents) : "each charge"}`,
      value: cents(cardFee),
    },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What's in the ${f.fee.label}`}
        className="ml-1 inline-flex size-11 -my-3 items-center justify-center align-middle"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-[22px] items-center justify-center rounded-full border-[1.5px] border-primary font-serif text-[12px] font-bold italic leading-none text-primary"
        >
          i
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex justify-between gap-3 pr-10">
              <span>{f.fee.label}</span>
              <span className="tabular-nums">{cents(feeTotal)}</span>
            </DialogTitle>
            <DialogDescription asChild>
              <span className="self-start rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-accent-foreground">{f.fee.pricingNote}</span>
            </DialogDescription>
          </DialogHeader>
          <table className="w-full border-collapse text-[15px]">
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="py-2 align-top">
                    {r.name}
                    <span className="block text-[13px] text-muted-foreground">{r.why}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right align-top tabular-nums">{r.value}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-bold">
                <td className="py-2">{f.fee.label}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{cents(feeTotal)}</td>
              </tr>
            </tbody>
          </table>
          {atCap && (
            <p className="text-[13px] text-muted-foreground">
              <b className="text-foreground">If the price goes up</b>
              {` (up to ${cents(atCap.goods)}), the card fee goes up with it, to at most ${cents(atCap.cardFee)}. So the most you'll pay is ${cents(atCap.max)}.`}
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">We don&apos;t make money on the fee yet. It covers what each gift costs us.</p>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One line of the cost box, as the confirm page draws it. */
export function CostLine({ label, value, strong, extra }: { label: string; value: string; strong?: boolean; extra?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className={cn(strong ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {extra}
      </span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
    </li>
  );
}

/** "Buying is paused": paying by card is switched off (connect_enabled), so nothing to add or buy. */
export function BuyingPaused() {
  return (
    <div role="status" className="flex flex-col gap-0.5 rounded-xl border border-border p-3 text-[15px]">
      <b>Buying is paused</b>
      <span>We can&apos;t buy gifts right now. Nothing was bought. We&apos;ll email you when it&apos;s back on.</span>
    </div>
  );
}

