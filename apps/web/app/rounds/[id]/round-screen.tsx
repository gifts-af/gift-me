"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  daysBetween,
  expectedArrival,
  FACT_VALUE_MAX,
  isLate,
  overBudgetLimitCents,
  picksBar,
  trackingLink,
  type RejectionCode,
} from "@gifts-af/core";
import { IdeaPhoto } from "@/components/idea-photo";
import { OCCASION_NAMES, shortDate } from "@/lib/occasion-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import type { BuyYourself, RoundPageIdea, RoundPageOrder, RoundPageView } from "@/modules/concierge";
import { money } from "@/app/people/[id]/money";
import { deliveredText, storeCancelledText } from "../gift-status";
import { OverBudgetSheet } from "../over-budget-sheet";

// The round screen (ALL-29, design/plans/ALL-29-approval.md AC-5–AC-7, AC-9, AC-12, AC-13a,
// AC-17, AC-18, AC-29, AC-30): list gifts first, then the AI's ideas; tick one or more and go on
// to the confirm page; an over-budget pick only on purpose; "Your budget" when the round has
// none; and "None of these" with a reason. Nothing here buys: "Buy n gifts" is a link to the
// confirm page, whose button does (AC-4a). Bought gifts show where they are under "Your gifts",
// with "It arrived" on a shipped one (design/plans/ALL-33-tracking.md).

export type RejectResult =
  | { ok: true; more: boolean }
  | { ok: false; error: "not_found" | "busy" | "not_open" | "changed" | "too_long" | "session" | "bad_form" };
export type BudgetResult = { ok: true } | { ok: false; error: string };
export type ArrivedAction = (roundId: string, orderId: string) => Promise<{ ok: boolean }>;
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

/**
 * A list gift from a store Zinc can only check has no live price: it's offered at the list's own
 * price, and says so (AC-27). Shared with the confirm page.
 */
export function listPriceNote(idea: Pick<RoundPageIdea, "source" | "livePrice">): string | null {
  return idea.source === "list" && !idea.livePrice ? "Price from their list" : null;
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
  // A tick before the page has loaded shows, but the pick is never counted.
  const hydrated = useHydrated();
  const store = storeLabel(idea.retailer);
  const meta = [money(idea.totalCents), listPriceNote(idea), store, idea.arriveBy ? `by ${shortDate(idea.arriveBy)}` : null]
    .filter(Boolean)
    .join(" · ");
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
          disabled={!pickable || !hydrated}
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

const CHIP = "self-start rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning";
// Links in a status line keep a full tap target (phone-layout.ts).
const LINE_LINK = "inline-flex min-h-11 items-center font-semibold text-primary";

function Dot({ tone }: { tone: "moving" | "done" }) {
  return <span aria-hidden className={cn("inline-block size-2 flex-none rounded-full", tone === "done" ? "bg-success" : "bg-primary")} />;
}

/** Where a bought gift is: the status line, an amber chip when it may be late, and the refund for a store cancel. */
function GiftStatus({ order, occasionDate, fixHref }: { order: RoundPageOrder; occasionDate: string; fixHref: string | null }) {
  if (order.status === "failed") {
    return (
      <>
        <span className={CHIP}>{storeCancelledText(order.refundCents)}</span>
        {fixHref && (
          <Link href={fixHref} className={cn(LINE_LINK, "self-start text-[13px]")}>
            Choose another gift
          </Link>
        )}
      </>
    );
  }
  if (order.status === "delivered") {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Dot tone="done" />
        {deliveredText(order.deliveredAt)}
      </span>
    );
  }
  if (order.status !== "shipped" && order.status !== "placed") {
    return <span className="text-[13px] font-semibold">Ordering</span>;
  }

  const expected = expectedArrival(order);
  const late = expected !== null && isLate(expected.date, occasionDate);
  const chip = late && (
    <span className={CHIP}>{`May arrive ${shortDate(expected.date)} · ${plural(daysBetween(occasionDate, expected.date), "day")} late`}</span>
  );
  if (order.status === "placed") {
    // Without a shipment, the store's own range says when it usually comes.
    const range = expectedArrival({ ...order, estDeliveryDate: null });
    return (
      <>
        {chip}
        <span className="text-[13px] font-semibold">{!late && range ? `Ordered · usually arrives by ${shortDate(range.date)}` : "Ordered"}</span>
      </>
    );
  }
  const link = order.packages.map(trackingLink).find((l) => l !== null) ?? null;
  return (
    <>
      {chip}
      <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold">
        <Dot tone="moving" />
        <span>{!late && expected ? `Shipped · due ${shortDate(expected.date)}` : "Shipped"}</span>
        {link && (
          <>
            <span aria-hidden>{" · "}</span>
            <a href={link} target="_blank" rel="noopener noreferrer" className={LINE_LINK}>
              Track it ↗
            </a>
          </>
        )}
      </span>
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ArrivedButton({ roundId, orderId, action }: { roundId: string; orderId: string; action: ArrivedAction }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function tap() {
    setError(null);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await action(roundId, orderId)).ok;
      } catch {
        ok = false;
      }
      // On success the page reloads with the gift delivered.
      if (!ok) setError("That didn't go through. Reload and try again.");
    });
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="mt-1 self-start" disabled={pending} onClick={tap}>
        It arrived
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function GiftRow({
  order,
  idea,
  roundId,
  occasionDate,
  fixHref,
  reactionHref,
  arrivedAction,
}: {
  order: RoundPageOrder;
  idea: RoundPageIdea | undefined;
  roundId: string;
  occasionDate: string;
  fixHref: string | null;
  reactionHref: string | null;
  arrivedAction: ArrivedAction | null;
}) {
  const meta = [money(order.totalCents ?? idea?.totalCents ?? order.maxPriceCents), storeLabel(idea?.retailer ?? null)].filter(Boolean).join(" · ");
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border p-3">
      <IdeaPhoto url={idea?.imageUrl ?? null} title={order.title} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{order.title}</span>
        <span className="text-[13px] text-muted-foreground">{meta}</span>
        <GiftStatus order={order} occasionDate={occasionDate} fixHref={fixHref} />
        {order.status === "shipped" && arrivedAction && <ArrivedButton roundId={roundId} orderId={order.id} action={arrivedAction} />}
        {reactionHref && (
          <Link href={reactionHref} aria-label={`How did it go? ${order.title}`} className={cn(LINE_LINK, "self-start text-[13px]")}>
            How did it go?
          </Link>
        )}
      </span>
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
  arrivedAction,
  reactionsOpen,
}: {
  view: RoundPageView;
  /** `rejectAction` */
  rejectAction: (roundId: string, form: FormData) => Promise<RejectResult>;
  /** `setBudgetAction` */
  setBudgetAction: (roundId: string, form: FormData) => Promise<BudgetResult>;
  /** `outlookAction`: whether this reason still brings new ideas; null when it couldn't be read. */
  outlookAction: (roundId: string, input: OutlookInput) => Promise<boolean | null>;
  /** `markArrived`; null while order tracking is switched off, which hides "It arrived". */
  arrivedAction: ArrivedAction | null;
  /** Whether a delivered gift asks how it went: the switch is on and the occasion has come. */
  reactionsOpen: boolean;
}) {
  const { round } = view;
  const budget = round.budgetCents;
  // A missing account row reads as no allowance: the server refuses anything over the budget then.
  const pct = view.overBudgetPct ?? 0;
  const ordered = new Set(view.liveOrders.map((o) => o.ideaId));
  const canBuy = view.closedText === null && round.status === "awaiting_approval";

  const bought = [...view.liveOrders, ...view.storeCancelled];
  // List gifts first (decisions 36, 37), each group in rank order; rejected ideas are gone, and so
  // are the gifts already under "Your gifts", so nothing is listed twice (owner, 2026-11-23).
  const inGifts = new Set(bought.map((o) => o.ideaId));
  const shown = view.ideas.filter((i) => i.status !== "rejected" && !inGifts.has(i.id)).sort((a, b) => a.rank - b.rank);
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
  // Picks still on the screen and still pickable: a refresh after None of these, a claim or a
  // cut link can take a ticked idea away.
  const live = picked.filter((id) => {
    const i = byId.get(id);
    return i !== undefined && pickable(i);
  });
  const barFor = (ids: string[]) => picksBar(ids.map((id) => byId.get(id)!.totalCents), budget, pct);
  const inOrder = (ids: Set<string>) => order.filter((i) => ids.has(i.id)).map((i) => i.id);

  function toggle(id: string) {
    const now = new Set(live);
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
    const fit = barFor(next).fit;
    // Past the allowance an earlier "Yes, pick it" no longer counts: coming back asks again.
    if (fit === "dropped") setOverOk(false);
    if (fit === "over") {
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

  /** Picks that went over without a tick (a budget saved under them): ask about the last one. */
  function review() {
    const last = live[live.length - 1];
    if (last) setPendingOver({ id: last, before: false });
  }

  function pickAnyway() {
    setOverOk(true);
    setPendingOver(null);
  }

  const bar = barFor(live);
  const buyable = bar.count > 0 && bar.fit !== "dropped" && (bar.fit !== "over" || overOk) && pendingOver === null;
  const buyLabel = bar.count === 0 ? "Buy gifts" : bar.count === 1 ? "Buy 1 gift" : `Buy ${bar.count} gifts`;
  const buyHref = `/rounds/${round.id}/buy?ideas=${live.join(",")}${bar.fit === "over" ? "&over=1" : ""}`;
  const offered = order.filter((i) => i.status === "proposed" || i.status === "selected");

  const card = (i: RoundPageIdea) => (
    <IdeaCard
      key={i.id}
      idea={i}
      budgetCents={budget}
      note={blockedBecause(i, ordered)}
      pickable={canBuy ? pickable(i) : null}
      checked={live.includes(i.id)}
      onToggle={() => toggle(i.id)}
    />
  );

  const ideaOf = new Map(view.ideas.map((i) => [i.id, i]));
  // A store cancel still to fix offers "Choose another gift" on its own row, so it isn't listed twice.
  const toFix = view.failedOrders.filter((o) => o.failureType !== "store_cancelled");
  const fixable = new Set(view.closedText === null ? view.failedOrders.map((o) => o.id) : []);

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

      {bought.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-gifts">
          <h2 id="round-gifts" className="text-[17px] font-bold">
            Your gifts
          </h2>
          <ul className="flex flex-col gap-2">
            {bought.map((o) => (
              <GiftRow
                key={o.id}
                order={o}
                idea={ideaOf.get(o.ideaId)}
                roundId={round.id}
                occasionDate={round.occasionDate}
                fixHref={fixable.has(o.id) ? `/rounds/${round.id}/fix/${o.id}` : null}
                reactionHref={reactionsOpen && o.status === "delivered" ? `/rounds/${round.id}/reaction?gift=${o.id}` : null}
                arrivedAction={arrivedAction}
              />
            ))}
          </ul>
        </section>
      )}

      {toFix.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="round-problems">
          <h2 id="round-problems" className="text-[17px] font-bold">
            Needs a fix
          </h2>
          <ul className="flex flex-col gap-2">
            {toFix.map((o) => (
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
          onDone={(more) => {
            setPicked([]);
            setOverOk(false);
            setDone(more ? "Looking again. New ideas will come by email." : "Saved. These ideas are still here to buy.");
          }}
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
          {bar.fit === "over" && !overOk && pendingOver === null && (
            <Button type="button" variant="outline" size="sm" onClick={review}>
              Over budget: review
            </Button>
          )}
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

      <OverBudgetSheet open={pendingOver !== null} totalCents={bar.totalCents} budgetCents={budget} onYes={pickAnyway} onKeep={keepWithin} />
    </>
  );
}
