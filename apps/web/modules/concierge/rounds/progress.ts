import { arrivalState, daysBetween, expectedArrival, type CalendarDate } from "@gifts-af/core";
import { chooseBy, shortDate } from "@/lib/occasion-format";
import { roundOutcome, type HoldState, type OrderState, type RoundDates, type waitingOn } from "./outcome";

// The one line that says where a gift round is, on Home and on a person's page. It must never be
// false, so it goes by the same rules as the round screen (outcome.ts). Pure.

export type ProgressRound = RoundDates & { attentionReason: string | null };
export type ProgressOrder = OrderState & {
  estDeliveryDate: CalendarDate | null;
  placedAt: string | null;
  handlingDaysMax: number | null;
  deliveryDaysMax: number | null;
  deliveredAt: string | null;
};
export type ProgressLine = {
  text: string;
  tone: "ready" | "warn" | "muted";
  /** The buyer can move it on, so it's listed first. */
  needsBuyer: boolean;
};

const ours = (text: string): ProgressLine => ({ text, tone: "muted", needsBuyer: false });
const yours = (text: string): ProgressLine => ({ text, tone: "warn", needsBuyer: true });

const WAITING = {
  looking: ours("Looking for ideas"),
  told: yours("No ideas found yet"),
  address: yours("Needs an address"),
  unknown: ours("No ideas yet"),
};
const ORDERED = ours("Ordered");

export type ProgressFacts = {
  /** `unknown`: what it waits on couldn't be read. */
  waiting: ReturnType<typeof waitingOn> | "unknown";
  /** How many ideas can still be picked; `some` or `unknown` when their list couldn't be read. */
  readyIdeas: number | "some" | "unknown";
  /** What the round's held gifts wait on; null with none. */
  hold: HoldState | null;
  today: CalendarDate;
  /** The setting gift_progress_days. */
  leaveAfterDays: number;
};

/** Null when the round isn't in progress: nothing can change it and no gift is on its way. */
export function progressLine(
  r: ProgressRound,
  orders: ProgressOrder[],
  o: ProgressFacts,
): ProgressLine | null {
  const { live, failed, closed } = roundOutcome(r, orders, o.today);
  const held = live.some((x) => x.status === "held");
  const moving = live.filter((x) => x.status !== "held");

  if (closed !== null) {
    const over = r.status === "complete" || r.status === "skipped";
    if (moving.length === 0 || (over && moving.every((x) => x.status === "delivered"))) return null;
    if (hasLeft(moving, r.occasionDate, o)) return null;
    // A held or failed gift is out of time here, but not closed yet: the others aren't the whole story.
    return orderLine(moving, held || failed.length > 0, r.occasionDate, o.today);
  }

  if (o.hold !== null && o.hold.kind !== "waiting") return yours(o.hold.text);
  if (failed.length > 0) return yours(`Needs a fix · Choose by ${chooseBy(r.shipBy)}`);
  if (moving.length > 0) {
    const line = orderLine(moving, held, r.occasionDate, o.today);
    return o.hold !== null && line === ORDERED ? ours(o.hold.text) : line;
  }
  if (o.hold !== null) return ours(o.hold.text);
  if (r.status === "awaiting_approval") {
    if (o.readyIdeas === 0) return yours("No ideas left");
    const by = `Choose by ${chooseBy(r.shipBy)}`;
    const ready = { unknown: by, some: `Ideas ready · ${by}`, 1: `1 idea ready · ${by}` }[o.readyIdeas] ?? `${o.readyIdeas} ideas ready · ${by}`;
    return { text: ready, tone: "ready", needsBuyer: true };
  }
  // Nothing more is tried or can be done: as a round closed as too late.
  if (o.waiting === "too_late") return null;
  if (o.waiting !== null) return WAITING[o.waiting];
  return r.status === "needs_attention" ? yours("Needs a look") : null;
}

/** The gifts on their way; `unfinished`: another gift isn't, so nothing further than Ordered is said. */
function orderLine(moving: ProgressOrder[], unfinished: boolean, occasionDate: CalendarDate, today: CalendarDate): ProgressLine {
  const arrivals = moving.filter((x) => x.status === "placed" || x.status === "shipped").map((x) => expectedArrival(x)?.date ?? null);
  const last = arrivals.reduce<string | null>((a, d) => (d !== null && (a === null || d > a) ? d : a), null);
  const arrival = last === null ? null : arrivalState(last, occasionDate, today);
  if (last !== null && arrival === "late") {
    return { text: `May arrive late · due ${shortDate(last)}`, tone: "warn", needsBuyer: false };
  }
  if (moving.some((x) => x.status === "placing" || x.status === "unconfirmed")) return ours("Confirming your order");
  if (unfinished || moving.some((x) => x.status === "placed")) return ORDERED;
  if (arrivals.length === 0) return ours("Delivered");
  if (last === null || arrivals.includes(null)) return ours("Shipped");
  return ours(`Shipped · ${arrival === "past" ? "was due" : "due"} ${shortDate(last)}`);
}

/**
 * Whether everything was bought and it's long enough since it arrived, or should have. Nothing says a
 * gift arrived when tracking never does, so without this its row would stay for good.
 */
function hasLeft(moving: ProgressOrder[], occasionDate: CalendarDate, o: ProgressFacts): boolean {
  if (moving.some((x) => x.status === "placing" || x.status === "unconfirmed")) return false;
  const arrived = moving.map((x) => x.deliveredAt?.slice(0, 10) ?? null);
  const allArrived = moving.every((x) => x.status === "delivered") && !arrived.includes(null);
  const due = moving.map((x) => (x.status === "delivered" ? null : (expectedArrival(x)?.date ?? null)));
  const last = [...arrived, ...due, allArrived ? null : occasionDate].reduce<string>((a, d) => (d !== null && d > a ? d : a), "");
  return daysBetween(last, o.today) >= o.leaveAfterDays;
}

type Sortable = { roundId: string; personName: string; date: CalendarDate; line: ProgressLine };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Home's order: what needs the buyer, then the nearest date; the rest only keeps it steady. */
export const byNeed = (a: Sortable, b: Sortable) =>
  Number(b.line.needsBuyer) - Number(a.line.needsBuyer) || cmp(a.date, b.date) || a.personName.localeCompare(b.personName) || cmp(a.roundId, b.roundId);
