import { expectedArrival, isLate, type CalendarDate } from "@gifts-af/core";
import { chooseBy, shortDate } from "@/lib/occasion-format";
import { roundOutcome, type OrderState, type RoundDates, type waitingOn } from "./outcome";

// The one line that says where a gift round is, on Home and on a person's page. It must never be
// false, so it goes by the same rules as the round screen (outcome.ts). Pure.

export type ProgressRound = RoundDates & { attentionReason: string | null };
export type ProgressOrder = OrderState & {
  estDeliveryDate: CalendarDate | null;
  placedAt: string | null;
  handlingDaysMax: number | null;
  deliveryDaysMax: number | null;
};
export type ProgressLine = {
  text: string;
  tone: "ready" | "warn" | "muted";
  /** The buyer can move it on, so it's listed first. */
  needsBuyer: boolean;
};

const ours = (text: string): ProgressLine => ({ text, tone: "muted", needsBuyer: false });
const yours = (text: string): ProgressLine => ({ text, tone: "warn", needsBuyer: true });

// The holds the buyer can clear; the others (paused, retry, not_allowed) are ours.
const HOLDS = new Map([
  ["address", "Needs an address"],
  ["setup", "Waiting on payment setup"],
  ["funds", "Waiting on your Zinc balance"],
]);
const WAITING = { looking: ours("Looking for ideas"), told: yours("No ideas found yet"), address: yours("Needs an address") };
const ORDERED = ours("Ordered");
const WAITING_TO_ORDER = ours("Waiting to order");

/** Null when the round isn't in progress: nothing can change it and no gift is on its way. */
export function progressLine(
  r: ProgressRound,
  orders: ProgressOrder[],
  o: { waiting: ReturnType<typeof waitingOn>; readyIdeas: number; today: CalendarDate },
): ProgressLine | null {
  const { live, failed, closed } = roundOutcome(r, orders, o.today);
  const held = live.some((x) => x.status === "held");
  const moving = live.filter((x) => x.status !== "held");

  if (closed !== null) {
    const over = r.status === "complete" || r.status === "skipped";
    if (moving.length === 0 || (over && moving.every((x) => x.status === "delivered"))) return null;
    // A held or failed gift is out of time here, but not closed yet: the others aren't the whole story.
    return orderLine(moving, held || failed.length > 0, r.occasionDate, o.today);
  }

  const hold = held && r.attentionReason !== null ? HOLDS.get(r.attentionReason) : undefined;
  if (hold) return yours(hold);
  if (failed.length > 0) return yours(`Needs a fix · Choose by ${chooseBy(r.shipBy)}`);
  if (moving.length > 0) {
    const line = orderLine(moving, held, r.occasionDate, o.today);
    return held && line === ORDERED ? WAITING_TO_ORDER : line;
  }
  if (held) return WAITING_TO_ORDER;
  if (r.status === "awaiting_approval") {
    if (o.readyIdeas === 0) return yours("No ideas left");
    const ready = o.readyIdeas === 1 ? "1 idea ready" : `${o.readyIdeas} ideas ready`;
    return { text: `${ready} · Choose by ${chooseBy(r.shipBy)}`, tone: "ready", needsBuyer: true };
  }
  if (o.waiting !== null) return WAITING[o.waiting];
  return r.status === "needs_attention" ? yours("Needs a look") : null;
}

/** The gifts on their way; `unfinished`: another gift isn't, so nothing further than Ordered is said. */
function orderLine(moving: ProgressOrder[], unfinished: boolean, occasionDate: CalendarDate, today: CalendarDate): ProgressLine {
  const arrivals = moving.filter((x) => x.status === "placed" || x.status === "shipped").map((x) => expectedArrival(x)?.date ?? null);
  const last = arrivals.reduce<string | null>((a, d) => (d !== null && (a === null || d > a) ? d : a), null);
  // Once its day has passed without news, "may arrive" would be a guess.
  if (last !== null && last >= today && isLate(last, occasionDate)) {
    return { text: `May arrive late · due ${shortDate(last)}`, tone: "warn", needsBuyer: false };
  }
  if (moving.some((x) => x.status === "placing" || x.status === "unconfirmed")) return ours("Confirming your order");
  if (unfinished || moving.some((x) => x.status === "placed")) return ORDERED;
  if (arrivals.length === 0) return ours("Delivered");
  if (last === null || arrivals.includes(null)) return ours("Shipped");
  return ours(`Shipped · ${last < today ? "was due" : "due"} ${shortDate(last)}`);
}

type Sortable = { roundId: string; personName: string; date: CalendarDate; line: ProgressLine };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Home's order: what needs the buyer, then the nearest date; the rest only keeps it steady. */
export const byNeed = (a: Sortable, b: Sortable) =>
  Number(b.line.needsBuyer) - Number(a.line.needsBuyer) || cmp(a.date, b.date) || a.personName.localeCompare(b.personName) || cmp(a.roundId, b.roundId);
