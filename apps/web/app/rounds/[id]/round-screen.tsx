"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { FACT_VALUE_MAX, overBudgetLimitCents, picksBar, type RejectionCode } from "@gifts-af/core";
import { IdeaPhoto } from "@/components/idea-photo";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BuyYourself, RoundPageIdea, RoundPageView } from "@/modules/concierge";
import { money } from "@/app/people/[id]/money";

// The round screen (ALL-29, design/plans/ALL-29-approval.md AC-5–AC-7, AC-9, AC-12, AC-13a,
// AC-17, AC-18, AC-29, AC-30): list gifts first, then the AI's ideas; tick one or more and go on
// to the confirm page; an over-budget pick only on purpose; "Your budget" when the round has
// none; and "None of these" with a reason. Nothing here buys: "Buy n gifts" is a link to the
// confirm page, whose button does (AC-4a).

export type RejectResult =
  | { ok: true; more: boolean }
  | { ok: false; error: "not_found" | "busy" | "not_open" | "changed" | "too_long" | "session" | "bad_form" };
export type BudgetResult = { ok: true } | { ok: false; error: string };
type OutlookInput = { code: RejectionCode; ownedIdeaId: string | null; text: string | null };

const CHIPS: { code: RejectionCode; label: string }[] = [
  { code: "has_it", label: "Already has one" },
  { code: "not_style", label: "Not their style" },
  { code: "too_pricey", label: "Too pricey" },
  { code: "too_generic", label: "Too generic" },
];

const REJECT_ERRORS: Record<Exclude<Extract<RejectResult, { ok: false }>["error"], "changed">, string> = {
  not_found: "That didn't go through. Reload and try again.",
  busy: "This round is busy right now. Try again in a minute.",
  not_open: "This round can't be changed now. Reload to see what happened.",
  too_long: `Keep it under ${FACT_VALUE_MAX} characters.`,
  session: "Your session ended. Sign in again.",
  bad_form: "That didn't go through. Reload and try again.",
};
const TRY_AGAIN = "That didn't go through. Try again.";

/** "Amazon" from the stored "amazon". */
function storeLabel(retailer: string | null): string | null {
  return retailer ? retailer.charAt(0).toUpperCase() + retailer.slice(1) : null;
}

/** Why an idea can't be ticked, in words for the card; null when it can. */
function blockedBecause(idea: RoundPageIdea, ordered: Set<string>): string | null {
  if (ordered.has(idea.id)) return "Ordered";
  if (idea.noLongerShared) return "No longer shared";
  if (idea.claimed) return "Someone else is getting this";
  // On one of this buyer's live orders, in this round or another (approve_round: already_bought).
  if (idea.claimedByMe) return "Already on one of your orders";
  return null;
}

function IdeaCard({
  idea,
  budgetCents,
  note,
  pickable,
  checked,
  onToggle,
}: {
  idea: RoundPageIdea;
  budgetCents: number | null;
  note: string | null;
  pickable: boolean | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const store = storeLabel(idea.retailer);
  const meta = [money(idea.totalCents), store, idea.arriveBy ? `by ${shortDate(idea.arriveBy)}` : null].filter(Boolean).join(" · ");
  const over = budgetCents !== null && idea.totalCents > budgetCents ? idea.totalCents - budgetCents : 0;
  const body = (
    <>
      <IdeaPhoto url={idea.imageUrl} title={idea.title} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">
          {idea.title}
          {over > 0 && (
            <span className="ml-2 inline-block rounded-md bg-warning-soft px-1.5 py-0.5 align-middle text-xs font-semibold text-warning">
              {`${money(over)} over`}
            </span>
          )}
        </span>
        <span className="text-[13px] text-muted-foreground">{meta}</span>
        {idea.reason && <span className="text-[13px]">{idea.reason}</span>}
        {note && <span className="text-[13px] font-semibold text-muted-foreground">{note}</span>}
      </span>
    </>
  );
  // A round that can't be bought from shows its ideas without boxes.
  if (pickable === null) {
    return <li className="flex items-start gap-3 rounded-xl border border-border p-3">{body}</li>;
  }
  return (
    <li>
      <label
        className={cn(
          "flex min-h-11 items-start gap-3 rounded-xl border border-border p-3",
          pickable ? "cursor-pointer" : "cursor-not-allowed opacity-50",
          checked && "border-primary ring-1 ring-primary",
        )}
      >
        <input
          type="checkbox"
          aria-label={idea.title}
          checked={checked}
          disabled={!pickable}
          onChange={onToggle}
          className="mt-1 size-5 flex-none accent-primary"
        />
        {body}
      </label>
    </li>
  );
}

function BuyYourselfRow({ item }: { item: BuyYourself }) {
  const meta = [item.priceCents !== null ? money(item.priceCents) : null, item.storeName].filter(Boolean).join(" · ");
  const note = item.claimed ? "Someone else is getting this" : item.claimedByMe ? "Already on one of your orders" : null;
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border border-border p-3", note && "opacity-50")}>
      <IdeaPhoto url={item.imageUrl} title={item.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{item.name}</span>
        {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
        {note && <span className="text-[13px] font-semibold text-muted-foreground">{note}</span>}
      </span>
      {!note && item.productUrl && (
        <Button asChild variant="outline" size="sm" className="flex-none">
          <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
            Buy it yourself
          </a>
        </Button>
      )}
    </li>
  );
}

function BudgetField({ roundId, action }: { roundId: string; action: (roundId: string, form: FormData) => Promise<BudgetResult> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      let result: BudgetResult;
      try {
        result = await action(roundId, form);
      } catch {
        result = { ok: false, error: TRY_AGAIN };
      }
      if (!result.ok) setError(result.error);
    });
  }
  return (
    <form action={submit} className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
      <label htmlFor="round-budget" className="text-[15px] font-semibold">
        Your budget
      </label>
      <p className="text-[13px] text-muted-foreground">Optional. Saved for this person and occasion, and marks ideas over it.</p>
      <div className="flex gap-2">
        <input
          id="round-budget"
          name="budget"
          inputMode="decimal"
          placeholder="75"
          aria-invalid={error ? true : undefined}
          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base placeholder:text-muted-foreground aria-[invalid=true]:border-destructive"
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending} className="flex-none">
          Save budget
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function NoneOfThese({
  roundId,
  ideas,
  rejectAction,
  outlookAction,
  onDone,
}: {
  roundId: string;
  /** The ideas still on offer, for "Which one?". */
  ideas: RoundPageIdea[];
  rejectAction: (roundId: string, form: FormData) => Promise<RejectResult>;
  outlookAction: (roundId: string, input: OutlookInput) => Promise<boolean | null>;
  onDone: (more: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<RejectionCode | null>(null);
  const [owned, setOwned] = useState<string | null>(null);
  const [text, setText] = useState("");
  // Whether this choice still brings new ideas (AC-13a); null until the server has said.
  const [more, setMore] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const asked = useRef(0);

  async function check(input: OutlookInput) {
    const seq = ++asked.current;
    let answer: boolean | null;
    try {
      answer = await outlookAction(roundId, input);
    } catch {
      answer = null;
    }
    if (seq !== asked.current) return;
    if (answer === null) setError(TRY_AGAIN);
    setMore(answer);
  }

  const trimmed = () => text.trim() || null;

  function chooseCode(next: RejectionCode) {
    setCode(next);
    setOwned(null);
    setError(null);
    if (next === "has_it") {
      asked.current++;
      setMore(null);
    } else void check({ code: next, ownedIdeaId: null, text: trimmed() });
  }

  function chooseOwned(id: string) {
    setOwned(id);
    void check({ code: "has_it", ownedIdeaId: id, text: trimmed() });
  }

  function textDone() {
    if (code && (code !== "has_it" || owned)) void check({ code, ownedIdeaId: owned, text: trimmed() });
  }

  function send() {
    if (!code || more === null) return;
    const form = new FormData();
    form.set("code", code);
    if (owned) form.set("owned", owned);
    form.set("text", text);
    form.set("expectMore", more ? "1" : "0");
    setError(null);
    startSending(async () => {
      let result: RejectResult;
      try {
        result = await rejectAction(roundId, form);
      } catch {
        setError(TRY_AGAIN);
        return;
      }
      if (result.ok) {
        setOpen(false);
        onDone(result.more);
      } else if (result.error === "changed") {
        // The outlook moved since the sheet showed it: nothing was saved, so show it again.
        await check({ code, ownedIdeaId: owned, text: trimmed() });
        setError("That changed. Check and send again.");
      } else setError(REJECT_ERRORS[result.error]);
    });
  }

  const ready = code !== null && (code !== "has_it" || owned !== null) && more !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="link" className="self-start px-0" onClick={() => setOpen(true)}>
        None of these
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why not these?</DialogTitle>
          <DialogDescription>The reason is saved to what we know, so the next ideas avoid it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.code}
              type="button"
              aria-pressed={code === c.code}
              onClick={() => chooseCode(c.code)}
              className={cn(
                "min-h-11 rounded-full border border-border px-4 text-[15px] font-semibold",
                code === c.code && "border-primary bg-accent text-accent-foreground ring-1 ring-primary",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {code === "has_it" && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[15px] font-semibold">Which one?</legend>
            {ideas.map((i) => (
              <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1">
                <input
                  type="radio"
                  name="owned"
                  value={i.id}
                  checked={owned === i.id}
                  onChange={() => chooseOwned(i.id)}
                  className="size-5 flex-none accent-primary"
                />
                <span className="text-[15px] [overflow-wrap:anywhere]">{i.title}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">Anything else? (optional)</span>
          <textarea
            value={text}
            maxLength={FACT_VALUE_MAX}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onBlur={textDone}
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 text-base"
          />
        </label>
        {more === false && (
          <div role="note" className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2 text-[13px]">
            <span className="font-semibold">No more new ideas this time</span>
            <span className="text-muted-foreground">The reason is saved, and these ideas stay here to buy.</span>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="button" disabled={!ready || sending} onClick={send}>
          {more === false ? "Save the reason" : "Find new ideas"}
        </Button>
        {more === true && <p className="text-center text-[13px] text-muted-foreground">New ideas come by email, usually by tomorrow.</p>}
      </DialogContent>
    </Dialog>
  );
}

export function RoundScreen({
  view,
  rejectAction,
  setBudgetAction,
  outlookAction,
}: {
  view: RoundPageView;
  /** `rejectAction` */
  rejectAction: (roundId: string, form: FormData) => Promise<RejectResult>;
  /** `setBudgetAction` */
  setBudgetAction: (roundId: string, form: FormData) => Promise<BudgetResult>;
  /** `outlookAction`: whether this reason still brings new ideas; null when it couldn't be read. */
  outlookAction: (roundId: string, input: OutlookInput) => Promise<boolean | null>;
}) {
  const { round } = view;
  const budget = round.budgetCents;
  // A missing account row reads as no allowance: the server refuses anything over the budget then.
  const pct = view.overBudgetPct ?? 0;
  const ordered = new Set(view.liveOrders.map((o) => o.ideaId));
  const canBuy = view.closedText === null && round.status === "awaiting_approval";

  // List gifts first (decisions 36, 37), each group in rank order; rejected ideas are gone.
  const shown = view.ideas.filter((i) => i.status !== "rejected").sort((a, b) => a.rank - b.rank);
  const listIdeas = shown.filter((i) => i.source === "list");
  const aiIdeas = shown.filter((i) => i.source !== "list");
  const order = [...listIdeas, ...aiIdeas];
  const pickable = (i: RoundPageIdea) => canBuy && i.status === "proposed" && blockedBecause(i, ordered) === null;

  const [picked, setPicked] = useState<string[]>([]);
  const [overOk, setOverOk] = useState(false);
  // The tick that took the picks over the budget, waiting on the sheet, and what was okayed before it.
  const [pendingOver, setPendingOver] = useState<{ id: string; before: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const byId = new Map(order.map((i) => [i.id, i]));
  const barFor = (ids: string[]) => picksBar(ids.map((id) => byId.get(id)!.totalCents), budget, pct);
  const inOrder = (ids: Set<string>) => order.filter((i) => ids.has(i.id)).map((i) => i.id);

  function toggle(id: string) {
    const now = new Set(picked);
    if (now.has(id)) {
      now.delete(id);
      const next = inOrder(now);
      setPicked(next);
      if (barFor(next).fit === "within") setOverOk(false);
      return;
    }
    now.add(id);
    const next = inOrder(now);
    setPicked(next);
    if (barFor(next).fit === "over") {
      setPendingOver({ id, before: overOk });
      setOverOk(false);
    }
  }

  function keepWithin() {
    if (!pendingOver) return;
    setPicked((p) => p.filter((x) => x !== pendingOver.id));
    setOverOk(pendingOver.before);
    setPendingOver(null);
  }

  function pickAnyway() {
    setOverOk(true);
    setPendingOver(null);
  }

  const bar = barFor(picked);
  const buyable = bar.count > 0 && bar.fit !== "dropped" && (bar.fit !== "over" || overOk) && pendingOver === null;
  const buyLabel = bar.count === 0 ? "Buy gifts" : bar.count === 1 ? "Buy 1 gift" : `Buy ${bar.count} gifts`;
  const buyHref = `/rounds/${round.id}/buy?ideas=${picked.join(",")}${bar.fit === "over" ? "&over=1" : ""}`;
  const offered = order.filter((i) => i.status === "proposed" || i.status === "selected");

  const card = (i: RoundPageIdea) => (
    <IdeaCard
      key={i.id}
      idea={i}
      budgetCents={budget}
      note={blockedBecause(i, ordered)}
      pickable={canBuy ? pickable(i) : null}
      checked={picked.includes(i.id)}
      onToggle={() => toggle(i.id)}
    />
  );

  const occasion = round.occasionKind ? OCCASION_NAMES[round.occasionKind as keyof typeof OCCASION_NAMES] : undefined;
  const subline = [
    occasion ? `${occasion} ${shortDate(round.occasionDate)}` : shortDate(round.occasionDate),
    budget !== null ? `Budget ${money(budget)}` : null,
    view.closedText === null ? `Choose by ${shortDate(round.shipByDeadline)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <p className="-mt-4 text-[13px] text-muted-foreground">{subline}</p>

      {view.closedText !== null && (
        <p role="status" className="rounded-xl border border-border p-3 text-[15px] font-semibold">
          {view.closedText}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl bg-accent p-3 text-[15px] text-accent-foreground">
          {done}
        </p>
      )}
      {!done && view.closedText === null && round.status === "generating" && (
        <p className="text-[15px] text-muted-foreground">Looking for new ideas. They&apos;ll come by email.</p>
      )}

      {view.failedOrders.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-problems">
          <h2 id="round-problems" className="text-[17px] font-bold">
            Needs a fix
          </h2>
          <ul className="flex flex-col gap-2">
            {view.failedOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{o.title}</span>
                <Button asChild variant="outline" size="sm" className="flex-none">
                  <Link href={`/rounds/${round.id}/fix/${o.id}`}>Fix this</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canBuy && budget === null && <BudgetField roundId={round.id} action={setBudgetAction} />}

      {view.closedText === null && listIdeas.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-list">
          <h2 id="round-list" className="text-[17px] font-bold">
            On their list
          </h2>
          <ul className="flex flex-col gap-2">{listIdeas.map(card)}</ul>
        </section>
      )}
      {view.closedText === null && aiIdeas.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-ideas">
          <h2 id="round-ideas" className="text-[17px] font-bold">
            {listIdeas.length > 0 ? "More ideas" : "Ideas"}
          </h2>
          <ul className="flex flex-col gap-2">{aiIdeas.map(card)}</ul>
        </section>
      )}

      {view.closedText === null && view.buyYourself.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-yourself">
          <h2 id="round-yourself" className="text-[17px] font-bold">
            From their list
          </h2>
          <p className="text-[13px] text-muted-foreground">We can&apos;t buy these for you, but the store can.</p>
          <ul className="flex flex-col gap-2">
            {view.buyYourself.map((item) => (
              <BuyYourselfRow key={item.itemId} item={item} />
            ))}
          </ul>
        </section>
      )}

      {canBuy && view.liveOrders.length === 0 && offered.length > 0 && !done && (
        <NoneOfThese
          roundId={round.id}
          ideas={offered}
          rejectAction={rejectAction}
          outlookAction={outlookAction}
          onDone={(more) => setDone(more ? "Looking again. New ideas will come by email." : "Saved. These ideas are still here to buy.")}
        />
      )}

      {canBuy && order.some(pickable) && (
        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:border-0 sm:px-0">
          <p className="flex flex-col text-[15px] tabular-nums" aria-live="polite">
            <span className={cn(bar.fit !== "within" && "font-semibold text-warning")}>
              {bar.count === 0
                ? "Pick one or more"
                : `${bar.count} picked · ${money(bar.totalCents)}${budget !== null ? ` of ${money(budget)}` : ""}`}
            </span>
            {bar.fit === "dropped" && budget !== null && (
              <span className="text-[13px] text-destructive">{`Over the most you allowed (${money(overBudgetLimitCents(budget, pct))})`}</span>
            )}
          </p>
          {buyable ? (
            <Button asChild className="w-full">
              <Link href={buyHref}>{buyLabel}</Link>
            </Button>
          ) : (
            <Button type="button" disabled className="w-full">
              {buyLabel}
            </Button>
          )}
        </div>
      )}

      <Dialog open={pendingOver !== null} onOpenChange={(o) => !o && keepWithin()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Over budget</DialogTitle>
            {budget !== null && (
              <DialogDescription>{`${money(bar.totalCents)} is ${money(bar.totalCents - budget)} over the ${money(budget)} budget.`}</DialogDescription>
            )}
          </DialogHeader>
          <Button type="button" onClick={pickAnyway}>
            Yes, pick it
          </Button>
          <Button type="button" variant="outline" onClick={keepWithin}>
            Keep within budget
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
