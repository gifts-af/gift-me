"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OCCASION_NAMES } from "@/lib/occasion-format";

// A failed gift's two ways out besides buying, on the fix page and the round screen's "Needs a
// fix" (ALL-185). "Pick a different gift" drops it and goes back to choosing; "Skip" closes the
// round for good, after asking. Both go to the round page, which then shows where things stand.

export type PickAgainResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "busy" | "not_open" | "not_current" | "other_gifts" | "session" | "bad_form" };
export type SkipResult = { ok: true } | { ok: false; error: "not_found" | "session" | "bad_form" };

const CHANGED = "This gift can't be changed now. Reload to see what happened.";
const WORDS: Record<Extract<PickAgainResult | SkipResult, { ok: false }>["error"], string> = {
  busy: "This round is busy right now. Try again in a minute.",
  not_open: CHANGED,
  not_current: CHANGED,
  other_gifts: CHANGED,
  not_found: "That didn't go through. Reload and try again.",
  session: "Your session ended. Sign in again.",
  bad_form: "That didn't go through. Reload and try again.",
};

// Birthdays and anniversaries read in lower case mid-sentence; the rest are names.
const LOWER = new Set(["birthday", "anniversary"]);

/** "Nora's birthday", "Nora's Christmas", or "their gift" when it can't say. */
export function occasionPhrase(personName: string | null, occasionKind: string | null): string {
  const whose = personName ? `${personName}'s` : "their";
  const name = occasionKind ? OCCASION_NAMES[occasionKind as keyof typeof OCCASION_NAMES] : undefined;
  if (!name) return `${whose} gift`;
  return `${whose} ${LOWER.has(occasionKind!) ? name.toLowerCase() : name}`;
}

export function WaysOut({
  roundId,
  orderId,
  giftTitle,
  personName,
  occasionKind,
  canPick,
  canSkip,
  pickAction,
  skipAction,
}: {
  roundId: string;
  orderId: string;
  giftTitle: string;
  personName: string | null;
  occasionKind: string | null;
  /** Only when this failed gift is the round's only one still in play (drop_failed_order). */
  canPick: boolean;
  /** Only when no gift in the round is held, being ordered or on its way, so nothing will be bought. */
  canSkip: boolean;
  /** `pickAgainAction` */
  pickAction: (roundId: string, orderId: string) => Promise<PickAgainResult>;
  /** `skipRoundAction` */
  skipAction: (roundId: string) => Promise<SkipResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const occasion = occasionPhrase(personName, occasionKind);
  const whose = personName ? `${personName}'s` : "their";
  if (!canPick && !canSkip) return null;

  function run(call: () => Promise<PickAgainResult | SkipResult>) {
    setError(null);
    start(async () => {
      let r: PickAgainResult | SkipResult;
      try {
        r = await call();
      } catch {
        r = { ok: false, error: "bad_form" };
      }
      if (!r.ok) {
        setAsking(false);
        setError(WORDS[r.error]);
        return;
      }
      setAsking(false);
      router.push(`/rounds/${roundId}`);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Other choices">
      {canPick && (
        <>
          <Button type="button" variant="outline" className="w-full" disabled={pending} aria-busy={pending} onClick={() => run(() => pickAction(roundId, orderId))}>
            Pick a different gift
          </Button>
          <p className="text-[13px] text-muted-foreground">{`Drops the ${giftTitle} and lets you choose from all of ${whose} ideas again, or ask for new ones.`}</p>
        </>
      )}
      {canSkip && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setAsking(true)}
          className="inline-flex min-h-11 items-center self-start text-[15px] text-destructive underline underline-offset-[3px] disabled:opacity-50"
        >
          {`Skip ${occasion}`}
        </button>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Dialog open={asking} onOpenChange={(o) => !pending && setAsking(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Skip ${occasion}?`}</DialogTitle>
            <DialogDescription>Nothing will be bought and we won&apos;t look for more ideas. You can&apos;t undo this.</DialogDescription>
          </DialogHeader>
          <Button type="button" variant="destructive" disabled={pending} aria-busy={pending} onClick={() => run(() => skipAction(roundId))}>
            Skip it
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setAsking(false)}>
            Keep looking
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
