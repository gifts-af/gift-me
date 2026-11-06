"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { centsLabel, dollarsLabel, zincFeeNotice } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaymentResult, PaymentStatus } from "@/modules/concierge";

type Connected = Extract<PaymentStatus, { kind: "connected" }>;
type Waiting = Extract<PaymentStatus, { kind: "waiting" }>;

export type PayingActions = {
  start: () => Promise<PaymentResult>;
  poll: () => Promise<PaymentResult>;
  cancel: () => Promise<PaymentResult>;
  disconnect: () => Promise<PaymentResult>;
  savePhone: (raw: string) => Promise<PaymentResult>;
};

/** "(555) 123-4567" from the 10 digits we keep. */
function phoneLabel(digits: string | null): string {
  return digits && digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : (digits ?? "");
}

const pill = "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold";
const box = "flex flex-col gap-1.5 rounded-xl border border-border p-3.5";

/**
 * Settings > Paying for gifts (ALL-32). One of four states at a time, from the
 * mock-up design/mockups/ALL-32-settings.html. `initial` is null when Zinc isn't
 * switched on in this environment.
 */
export function PayingForGifts({ initial, actions }: { initial: PaymentStatus | null; actions: PayingActions }) {
  const [status, setStatus] = useState<PaymentStatus | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<PaymentResult>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if ("error" in result) setError(result.error);
      else setStatus(result);
    });
  }

  // While waiting for Allow, ask at the interval Zinc gave us. Another tab may be
  // polling too; the server lets only one of us reach Zinc.
  const waiting = status?.kind === "waiting" ? status : null;
  const waitingKey = waiting ? `${waiting.userCode}:${waiting.intervalSec}` : null;
  const poll = useRef(actions.poll);
  poll.current = actions.poll;
  useEffect(() => {
    if (!waitingKey) return;
    const interval = Number(waitingKey.split(":")[1]);
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await poll.current();
        if (live && !("error" in result)) setStatus(result);
      } catch {
        // A dropped connection: the next status change schedules another poll.
        if (live) setStatus((s) => (s?.kind === "waiting" ? { ...s } : s));
      }
    }, interval * 1000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [waitingKey, status]);

  return (
    <section aria-labelledby="paying-heading" className="flex flex-col gap-3">
      <h2 id="paying-heading" className="text-[17px] font-semibold">
        {waiting ? "Connect Zinc" : "Paying for gifts"}
      </h2>

      {status === null && <p className="text-[15px] text-muted-foreground [text-wrap:balance]">Paying for gifts isn&apos;t switched on here yet.</p>}

      {status?.kind === "not_allowed" && (
        <p className="text-[15px] text-muted-foreground [text-wrap:balance]">
          Buying gifts is open to test accounts during the alpha. We&apos;ll tell you when it opens up.
        </p>
      )}

      {status?.kind === "not_connected" && (
        <>
          {status.notice && (
            <p role="status" className="text-[15px]">
              {status.notice}
            </p>
          )}
          <p className="text-[15px] [text-wrap:balance]">
            Gifts are paid from your own <b>Zinc</b> balance. Zinc buys from the store for us. We never see your card.
          </p>
          <p className="text-[15px] text-muted-foreground [text-wrap:balance]">Takes about a minute: sign in to Zinc (or make an account) and click Allow.</p>
          <div role="note" className="rounded-lg bg-warning-soft px-2.5 py-2 text-[13px] text-warning">
            {zincFeeNotice(status.feeCents)}
          </div>
          <Button type="button" disabled={pending} aria-busy={pending} onClick={() => run(actions.start)} className="w-full">
            {pending ? "Connecting…" : "Connect Zinc"}
          </Button>
        </>
      )}

      {waiting && <WaitingForAllow status={waiting} pending={pending} onCancel={() => run(actions.cancel)} />}

      {status?.kind === "connected" && (
        <ConnectedView
          status={status}
          actions={actions}
          pending={pending}
          onStatus={setStatus}
          onError={setError}
          onDisconnect={() => run(actions.disconnect)}
        />
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function WaitingForAllow({ status, pending, onCancel }: { status: Waiting; pending: boolean; onCancel: () => void }) {
  // Null until the page's JavaScript runs, so the server and browser renders match.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = now === null ? null : Math.max(0, Math.ceil((new Date(status.expiresAt).getTime() - now) / 60_000));

  return (
    <>
      <ol className="list-decimal pl-5 text-[15px] [&>li]:my-1">
        <li>
          Tap <b>Open Zinc</b>.
        </li>
        <li>Sign in, or make an account.</li>
        <li>
          Check Zinc shows this code, then click <b>Allow</b>.
        </li>
      </ol>
      <p
        aria-label="Your code"
        className="rounded-lg bg-muted px-2.5 py-2.5 text-center font-mono text-2xl font-bold tracking-[0.12em] tabular-nums"
      >
        {status.userCode}
      </p>
      <Button asChild className="w-full">
        <a href={status.verificationUrl} target="_blank" rel="noopener noreferrer">
          Open Zinc
        </a>
      </Button>
      <p role="status" className="text-center text-[14px] text-muted-foreground">
        <span className="block">Waiting for you to click Allow…</span>
        <span className="block tabular-nums">Code expires in {minutes === null ? "…" : minutes} min</span>
      </p>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel} className="self-center font-semibold text-primary">
        Cancel
      </Button>
    </>
  );
}

function ConnectedView({
  status,
  actions,
  pending,
  onStatus,
  onError,
  onDisconnect,
}: {
  status: Connected;
  actions: PayingActions;
  pending: boolean;
  onStatus: (s: PaymentStatus) => void;
  onError: (e: string | null) => void;
  onDisconnect: () => void;
}) {
  const [phone, setPhone] = useState(phoneLabel(status.phone));
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();
  const [open, setOpen] = useState(false);

  function save() {
    onError(null);
    setSaved(false);
    startSaving(async () => {
      const result = await actions.savePhone(phone);
      if ("error" in result) onError(result.error);
      else {
        onStatus(result);
        setSaved(true);
      }
    });
  }

  const weeks = status.lookaheadDays % 7 === 0 ? `${status.lookaheadDays / 7} weeks` : `${status.lookaheadDays} days`;
  const topUp = status.autoTopUp;

  return (
    <>
      <div className={box}>
        <p className="text-sm text-muted-foreground">Zinc balance</p>
        {status.balanceCents === null ? (
          <p className="text-[15px]">We couldn&apos;t load your balance just now.</p>
        ) : (
          <p className="text-3xl font-bold tabular-nums">{centsLabel(status.balanceCents)}</p>
        )}
        <p className="text-sm text-muted-foreground">
          Auto top-up{" "}
          <span
            className={`${pill} ${topUp === true ? "bg-success-soft text-success" : topUp === false ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground"}`}
          >
            {topUp === true ? "On" : topUp === false ? "Off" : "Not known yet"}
          </span>
        </p>
        {status.lookahead.cents > 0 || status.lookahead.atLeast ? (
          <p className="mt-1 text-sm text-warning">
            {status.lookahead.atLeast ? "At least " : ""}
            <span className="tabular-nums">{dollarsLabel(status.lookahead.cents)}</span> in gifts are due in the next {weeks}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No gifts are due in the next {weeks}.</p>
        )}
      </div>

      {topUp !== true && (
        <div className={box}>
          <h3 className="text-[17px] font-semibold">Turn on auto top-up</h3>
          <p className="text-sm text-muted-foreground">Zinc refills your balance from your card, so a gift never stalls.</p>
          <ol className="list-decimal pl-5 text-[15px] [&>li]:my-1">
            <li>Open your Zinc wallet.</li>
            <li>Add a card.</li>
            <li>
              Turn on auto top-up: keep at least{" "}
              {status.suggestedMinimumCents === null ? (
                <>enough for your biggest gift plus {dollarsLabel(status.feeCents)}</>
              ) : (
                <>
                  <b className="tabular-nums">{dollarsLabel(status.suggestedMinimumCents)}</b> (your biggest budget + {dollarsLabel(status.feeCents)})
                </>
              )}
              , top up by <b className="tabular-nums">{dollarsLabel(status.topUpSuggestCents)}</b>.
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">Each top-up costs 2.9% + 30¢.</p>
          <Button asChild className="w-full">
            <a href={status.walletUrl} target="_blank" rel="noopener noreferrer">
              Open Zinc wallet
            </a>
          </Button>
        </div>
      )}

      <div className={box}>
        <Label htmlFor="buyer-phone" className="text-[17px] font-semibold">
          Your phone
        </Label>
        <p id="buyer-phone-hint" className="text-sm text-muted-foreground">
          Stores need one on every order. Only used for delivery.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="buyer-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setSaved(false);
            }}
            aria-describedby="buyer-phone-hint"
            className="num"
          />
          <Button type="button" variant="outline" disabled={saving} aria-busy={saving} onClick={save} className="w-full sm:w-auto">
            {saving ? "Saving…" : "Save phone"}
          </Button>
        </div>
        {saved && (
          <p role="status" className="text-[13px] text-success">
            Saved
          </p>
        )}
        {!status.phone && !saved && <p className="text-[13px] text-muted-foreground">Gifts can&apos;t be ordered until a phone is saved.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" className="self-center font-semibold text-destructive">
            Disconnect Zinc
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Zinc?</DialogTitle>
            <DialogDescription>
              {status.onTheWayCount > 0
                ? `${status.onTheWayCount} ${status.onTheWayCount === 1 ? "gift is" : "gifts are"} on the way. We'll stop tracking ${status.onTheWayCount === 1 ? "it" : "them"}. `
                : ""}
              Gifts waiting to be ordered will wait until you connect again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              Disconnect
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
