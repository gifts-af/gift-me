"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AddCard, CardReturnNotice, PhoneField, type StartCardResult } from "@/app/rounds/card-ui";

// Settings > Paying for gifts for a card buyer (mock-ups 4a to 4c, approved 2026-11-27): the saved
// card's brand and last four, read live from Stripe (nothing card-related is stored), Replace
// and Remove, and the phone. No Zinc account, balance or top-up. Saving a card never buys.

export type SavedCardView = { brand: string; last4: string } | null | "unreadable";

export type CardPayingInitial = {
  /** Paying by card is on (connect_enabled); off hides Add a card and Replace (AC-12). */
  on: boolean;
  /** A card is saved: its details, or "unreadable" when Stripe couldn't be asked just now. Null: none. */
  card: SavedCardView;
  phone: string | null;
  /** The return route's `card=`, when the buyer just came back from Stripe's page. */
  cardReturn: string | null;
};

export type RemoveCardResult = { ok: true } | { ok: false; error: "placing" | "session" | "failed" };
export type SavePhoneResult = { ok: true } | { ok: false; error: string };

export type CardPayingActions = {
  startCard: (phone: string | null) => Promise<StartCardResult>;
  remove: () => Promise<RemoveCardResult>;
  savePhone: (raw: string) => Promise<SavePhoneResult>;
};

const REMOVE_WORDS: Record<Extract<RemoveCardResult, { ok: false }>["error"], string> = {
  placing: "A gift is being bought with this card. You can remove it once that's confirmed.",
  session: "Your session ended. Sign in again.",
  failed: "We couldn't remove your card. Try again in a minute.",
};

/** "(555) 123-4567" from the 10 digits we keep. */
function phoneLabel(digits: string | null): string {
  return digits && digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : (digits ?? "");
}

/** "Visa", "Mastercard", "American Express": Stripe's brand codes in words. */
function brandName(brand: string): string {
  const known: Record<string, string> = { amex: "American Express", mastercard: "Mastercard", visa: "Visa", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };
  return known[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function CardPaying({ initial, actions }: { initial: CardPayingInitial; actions: CardPayingActions }) {
  const [card, setCard] = useState<SavedCardView>(initial.card);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replacing, startReplacing] = useTransition();

  function remove() {
    setRemoveError(null);
    startRemoving(async () => {
      let r: RemoveCardResult;
      try {
        r = await actions.remove();
      } catch {
        r = { ok: false, error: "failed" };
      }
      if (r.ok) setCard(null);
      else setRemoveError(REMOVE_WORDS[r.error]);
    });
  }

  function replace() {
    setReplaceError(null);
    startReplacing(async () => {
      let r: StartCardResult;
      try {
        r = await actions.startCard(null);
      } catch {
        r = { ok: false, error: "unavailable" };
      }
      if (r.ok) window.location.assign(r.url);
      else setReplaceError(r.error === "off" ? "Buying is paused right now, so you can't add a card." : "We couldn't open the card page. Try again in a minute.");
    });
  }

  return (
    <section aria-labelledby="paying-heading" className="flex flex-col gap-3">
      <h2 id="paying-heading" className="text-[17px] font-semibold">
        Paying for gifts
      </h2>
      <CardReturnNotice status={initial.cardReturn} />

      {card ? (
        <>
          <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
            <div className="flex items-center gap-3">
              {card !== "unreadable" && (
                <span aria-hidden="true" className="rounded-md border border-border bg-muted px-2 py-[7px] text-[12px] font-extrabold uppercase leading-none tracking-[.04em]">
                  {card.brand}
                </span>
              )}
              <span className="flex min-w-0 flex-col text-[15px]">
                <b>{card === "unreadable" ? "Saved card" : `${brandName(card.brand)} ending in ${card.last4}`}</b>
                <span className="text-[13px] text-muted-foreground">
                  {card === "unreadable" ? "We couldn't load your card's details just now." : "Charged only for gifts you approve."}
                </span>
              </span>
            </div>
            <div className={initial.on ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>
              {initial.on && (
                <Button type="button" variant="outline" disabled={replacing} aria-busy={replacing} onClick={replace}>
                  Replace card
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={removing}
                aria-busy={removing}
                onClick={remove}
                className="border-destructive text-destructive dark:border-destructive"
              >
                Remove card
              </Button>
            </div>
            {(removeError ?? replaceError) && (
              <p role="alert" className="text-[14px] font-semibold text-destructive">
                {removeError ?? replaceError}
              </p>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground">Stripe keeps your card. We never see the number.</p>
          <PhoneBox phone={initial.phone} save={actions.savePhone} />
        </>
      ) : initial.on ? (
        <>
          <p className="text-[15px]">No card saved. Add one to buy gifts. Saving a card doesn&apos;t buy anything.</p>
          <AddCard start={actions.startCard} needsPhone={initial.phone === null} variant="outline" />
        </>
      ) : (
        <p role="status" className="text-[15px]">
          No card saved. Buying is paused right now.
        </p>
      )}
    </section>
  );
}

function PhoneBox({ phone, save }: { phone: string | null; save: CardPayingActions["savePhone"] }) {
  const [value, setValue] = useState(phoneLabel(phone));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  function go() {
    setError(null);
    setSaved(false);
    startSaving(async () => {
      let r: SavePhoneResult;
      try {
        r = await save(value);
      } catch {
        r = { ok: false, error: "That didn't work. Try again in a minute." };
      }
      if (r.ok) setSaved(true);
      else setError(r.error);
    });
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
      <PhoneField id="buyer-phone" value={value} onChange={(v) => (setValue(v), setSaved(false))} hint="Stores need one on every order. Only used for delivery." />
      <Button type="button" variant="outline" disabled={saving} aria-busy={saving} onClick={go} className="w-full sm:w-auto sm:self-start">
        {saving ? "Saving…" : "Save phone"}
      </Button>
      {saved && (
        <p role="status" className="text-[13px] text-success">
          Saved
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
