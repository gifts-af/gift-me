import { addDays, type AttentionReason, type CalendarDate, type OccasionKind, type RenamedStepKey, type StepKey } from "@gifts-af/core";
import { OCCASION_NAMES, shortDate } from "@/lib/occasion-format";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import type { ClaimedRound, RoundContext, RoundOrder } from "./store";
import type { EngineDeps } from "./engine";
import type { Extra } from "./steps";

// The round engine's emails: turns a step and the round's context into a notify() call.

/** "Choose by": the day before the ship-by day, since that day's tick closes the round. */
export const chooseBy = (shipBy: CalendarDate) => shortDate(addDays(shipBy, -1));

// Pages of the round screen (ALL-29); the emails link to them with plain links, no token.
const roundPath = (roundId: string) => `/rounds/${roundId}`;
const buyPath = (roundId: string, ideaId: string) => `${roundPath(roundId)}/buy?ideas=${ideaId}`;
export const fixPath = (roundId: string, orderId: string) => `${roundPath(roundId)}/fix/${orderId}`;


/** "$42" or "$38.50". */
export function money(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

/** "birthday", "Mother's Day": a holiday keeps its capitals in a sentence. */
export function occasionWord(kind: OccasionKind): string {
  return kind === "birthday" || kind === "anniversary" ? OCCASION_NAMES[kind].toLowerCase() : OCCASION_NAMES[kind];
}

// A renamed key (heads_up@1) is only read, never sent.
type TrackingStep = "delivered" | `${"late" | "ontime" | "cancel_late"}:${string}`;
type PlainStep = Exclude<
  StepKey,
  `hold:${string}` | `fail:${string}` | `ordered:${string}` | `late_fail:${string}` | "shared_address" | RenamedStepKey | TrackingStep | "reaction_prompt"
>;
/** Which email a step key sends; the numbered keys group by kind. Failures are told by tellFailures. */
type EmailStep = PlainStep | "hold" | "hold_short" | "hold_deadline" | "fail" | "ordered" | "tracking" | "reaction";

function emailStep(step: StepKey): EmailStep {
  if (step.startsWith("hold:")) {
    if (step.includes(":short:")) return "hold_short";
    return step.endsWith(":deadline") ? "hold_deadline" : "hold";
  }
  if (step.startsWith("fail:")) return "fail";
  if (step.startsWith("ordered:") || step.startsWith("late_fail:")) return "ordered";
  if (step === "delivered" || /^(late|ontime|cancel_late):/.test(step)) return "tracking";
  if (step === "reaction_prompt") return "reaction";
  return step as PlainStep;
}

export const LIVE_HELD = (o: RoundOrder) => o.status === "held";
const ON_ITS_WAY = (o: RoundOrder) => ["placing", "placed", "shipped", "delivered"].includes(o.status);

export async function sendEmail(step: StepKey, round: ClaimedRound, ctx: RoundContext, deps: EngineDeps, extra: Extra): Promise<NotifyResult> {
  const notifyDeps: NotifyDeps = deps.notify;
  const base = { userId: round.userId, roundId: round.id };
  const occasion = {
    personName: ctx.personName,
    occasion: occasionWord(ctx.occasionKind),
    dateText: shortDate(ctx.occasionDate),
  };
  const ideas = ctx.ideas.map((i) => ({
    title: i.title,
    price: money(i.totalCents),
    ...(i.overBudget ? { overBudget: true } : {}),
    ...(i.arriveBy ? { arriveBy: shortDate(i.arriveBy) } : {}),
    ...(i.store ? { store: i.store } : {}),
    ...(i.reason ? { reason: i.reason } : {}),
  }));
  // The approval emails link each idea's "Buy this" and the one button to the round screen with
  // plain links (ALL-29); the other emails open the person's page with one-time links that last
  // until the end of the deadline day.
  const approval = {
    choose: { path: roundPath(round.id) },
    ...Object.fromEntries(ctx.ideas.map((i, n) => [`buy${n}`, { path: buyPath(round.id, i.id) }])),
  };
  const link = { action: "open_person" as const, expiresAt: new Date(`${round.shipByDeadline}T23:59:00Z`) };
  // The address emails open the person's address form instead (ALL-81).
  const addressLink = { ...link, action: "add_address" as const };
  // Open guided questions, when there are any (ALL-26, design §6.7).
  const asks = ctx.openQuestions > 0 ? { questions: ctx.openQuestions } : {};
  const questionsLink = ctx.openQuestions > 0 ? { questions: { ...link, action: "answer_questions" as const } } : {};
  // The hold emails (ALL-32): the gifts waiting, and a plain "Cancel this gift" link.
  const cancelLink = { ...link, action: "cancel_held_gift" as const };
  const held = ctx.orders.filter(LIVE_HELD);
  const gifts = { ...occasion, giftTitles: held.map((o) => o.title) };
  const feeText = async () => money(await deps.store.setting("zinc_order_fee_cents"));
  const reason: AttentionReason | null = round.attentionReason;

  const kind = emailStep(step);
  switch (kind) {
    case "heads_up":
      return notify(
        {
          ...base,
          kind: "heads_up",
          data: { ...occasion, ...asks, mode: "reminder", ideas, late: round.late, ...(extra.funding ? { funding: extra.funding } : {}) },
          links: { ...approval, ...questionsLink },
        },
        notifyDeps,
      );
    case "reminder_1":
    case "reminder_2":
      return notify(
        { ...base, kind: "reminder", data: { ...occasion, ...asks, ideas }, links: { ...approval, ...questionsLink } },
        notifyDeps,
      );
    case "final_notice":
      return notify(
        {
          ...base,
          kind: "final_notice",
          // The day before ship-by: that day's tick closes the round (ALL-116 plan review).
          data: { ...occasion, ideas, orderByText: chooseBy(round.shipByDeadline) },
          links: approval,
        },
        notifyDeps,
      );
    case "held_cancelled":
    case "skipped":
      // A money-path round at its deadline: the buyer had chosen a gift (ALL-32).
      return notify(
        {
          ...base,
          kind: "skipped",
          data: {
            ...occasion,
            ...(round.status === "needs_attention" ? { held: true } : {}),
            ...(extra.partial ? { partial: extra.partial } : {}),
          },
          links: { open: link },
        },
        notifyDeps,
      );
    case "address_request":
      return notify({ ...base, kind: "needs_address", data: occasion, links: { addAddress: addressLink } }, notifyDeps);
    case "address_reminder_1":
    case "address_reminder_2":
    case "address_final_notice":
      return notify(
        { ...base, kind: "needs_address", data: { ...occasion, reminder: true }, links: { addAddress: addressLink } },
        notifyDeps,
      );
    case "missed_on_us":
      return notify({ ...base, kind: "missed_on_us", data: gifts, links: { open: link } }, notifyDeps);
    case "no_ideas":
    case "no_ideas_again":
      return notify(
        {
          ...base,
          kind: "no_ideas",
          data: { personName: ctx.personName, again: kind === "no_ideas_again" },
          links: { questions: { ...link, action: "answer_questions" } },
        },
        notifyDeps,
      );
    case "hold_trouble":
      return notify(
        { ...base, kind: "hold_trouble", data: { ...gifts, feeText: await feeText() }, links: { open: link, cancel: cancelLink } },
        notifyDeps,
      );
    case "hold_deadline":
      return notify(
        { ...base, kind: "hold_unconfirmed", data: { ...gifts, giftTitles: unconfirmedTitles(ctx) }, links: { open: link } },
        notifyDeps,
      );
    case "hold":
    case "hold_short":
      return sendHold(reason, kind === "hold_short");
    case "fail":
      // Told by tellFailures and tellClosing, which claim each failure's key first; never a round step.
      throw new Error("Failures are told by tellFailures");
    case "ordered":
      // Sent by tellOrdered, which knows the order (ordered and late_fail); never a round step.
      throw new Error("The ordered and late failure emails are sent by tellOrdered");
    case "tracking":
      // A bought gift's news (late, on time, store cancelled, delivered) claims its own key; never a round step.
      throw new Error("Tracking news is sent by its own step");
    case "reaction":
      // Sent by runReactions, which claims its key; never a round step.
      throw new Error("The reaction email is sent by runReactions");
    default: {
      const unknown: never = kind;
      throw new Error(`No email for step ${String(unknown)}`);
    }
  }

  async function sendHold(r: AttentionReason | null, still: boolean): Promise<NotifyResult> {
    switch (r) {
      case "funds": {
        const needed = held.reduce((sum, o) => sum + o.maxPriceCents + o.feeCents, 0);
        const have = round.seenBalanceCents;
        const placed = ctx.orders.find(ON_ITS_WAY);
        return notify(
          {
            ...base,
            kind: "hold_funds",
            data: {
              ...gifts,
              neededText: money(needed),
              ...(have !== null ? { haveText: money(have), shortText: money(Math.max(0, needed - have)) } : {}),
              feeText: await feeText(),
              walletUrl: deps.zinc?.walletUrl ?? `${notifyDeps.baseUrl}/settings/paying`,
              ...(placed ? { placedTitle: placed.title } : {}),
              ...(still ? { still: true } : {}),
            },
            links: { cancel: cancelLink },
          },
          notifyDeps,
        );
      }
      case "setup":
        return notify(
          {
            ...base,
            kind: "hold_setup",
            data: { ...gifts, feeText: await feeText() },
            links: { setup: { ...link, action: "open_settings" }, cancel: cancelLink },
          },
          notifyDeps,
        );
      case "address":
        return notify(
          {
            ...base,
            kind: "hold_address",
            data: { ...gifts, feeText: await feeText() },
            links: { addAddress: addressLink, cancel: cancelLink },
          },
          notifyDeps,
        );
      case "unconfirmed":
        return notify(
          { ...base, kind: "hold_unconfirmed", data: { ...gifts, giftTitles: unconfirmedTitles(ctx) }, links: { open: link } },
          notifyDeps,
        );
      default:
        throw new Error(`No hold email for reason ${r}`);
    }
  }

}

function unconfirmedTitles(ctx: RoundContext): string[] {
  return ctx.orders.filter((o) => o.status === "unconfirmed").map((o) => o.title);
}
