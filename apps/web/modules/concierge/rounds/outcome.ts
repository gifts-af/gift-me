import type { CalendarDate } from "@gifts-af/core";

// What a round has come to, from its own columns and its orders: the one set of rules behind the
// round screen's words and the status line on Home and a person's page. Pure: callers read the rows.

export type RoundDates = {
  status: string;
  closedAt: string | null;
  shipBy: CalendarDate;
  occasionDate: CalendarDate;
  /** Null once a date change ended the round (T92). */
  occasionYear: number | null;
};
export type OrderState = { status: string; failureType: string | null; resolved: boolean };

/** Why a round can't be bought from any more. */
export type Closed = "moved" | "ordered" | "confirming" | "passed" | "none_coming" | "too_late" | "stopped";

const ORDERED_STATUSES = new Set(["ordered", "delivered", "complete"]);
// Not given, as concierge.order_is_given counts it (failed ones are split out below).
const NOT_LIVE = new Set(["cancelled", "failed", "refunded"]);
const BOUGHT = new Set(["placed", "shipped", "delivered"]);
const IN_FLIGHT = new Set(["placing", "unconfirmed"]);
const NO_IDEAS_YET = new Set(["scheduled", "needs_address", "generating"]);

/** `closed` is null while the round can still change. */
export function roundOutcome<O extends OrderState>(r: RoundDates, orders: O[], today: CalendarDate) {
  const live = orders.filter((o) => !NOT_LIVE.has(o.status));
  // A failure already dealt with (replaced, or its round closed) is nothing to fix.
  const failed = orders.filter((o) => o.status === "failed" && !o.resolved);
  const storeCancelled = orders.filter((o) => o.status === "failed" && o.failureType === "store_cancelled");
  // From the ship-by day on, as approve_round refuses it.
  const pastDeadline = today >= r.shipBy;
  const ended = r.closedAt !== null || r.status === "skipped" || ORDERED_STATUSES.has(r.status);
  // An ordered round's orders stay placing until the store confirms them (reconcile_round never leaves
  // an unconfirmed one there). A round can also end with only some of its gifts bought.
  const bought = ORDERED_STATUSES.has(r.status) ? live : live.filter((o) => BOUGHT.has(o.status));
  let closed: Closed | null = null;
  if (ended || pastDeadline) {
    // Only a date change leaves a round without a year, and never one with a gift on its way.
    if (r.occasionYear === null) closed = "moved";
    else if (bought.length > 0) closed = "ordered";
    // Zinc may still turn out to have bought it, so nothing here may say no gift is coming.
    else if (live.some((o) => IN_FLIGHT.has(o.status))) closed = "confirming";
    else if (today > r.occasionDate) closed = "passed";
    else if (storeCancelled.length > 0 || (ended && orders.some((o) => o.status === "cancelled" || o.status === "refunded"))) closed = "none_coming";
    else if (pastDeadline) closed = "too_late";
    else closed = "stopped";
  }
  return { live, failed, storeCancelled, bought, closed };
}

/** What a held gift waits on, and its words. */
export type HoldState = { kind: "funds" | "setup" | "address" | "check_address" | "cancel_only" | "waiting"; text: string };
const HOLDS: Record<HoldState["kind"], string> = {
  funds: "Waiting on your Zinc balance",
  setup: "Waiting on payment setup",
  address: "Needs an address",
  check_address: "Check the address",
  cancel_only: "Needs an address",
  waiting: "Waiting to order",
};

/**
 * Why an open round's held gifts wait, by the round's reason. It only moves when the round is next
 * looked at, so an address hold goes by the address there is now (null: it couldn't be read).
 * `rejected`: the store couldn't use the person's own address. `toPerson`: it ships to the person, the
 * only place whose address can be changed here.
 */
export function holdState(
  reason: string | null,
  address: { shared: boolean; own: boolean; rejected: boolean; toPerson: boolean } | null,
): HoldState {
  return ((kind: HoldState["kind"]) => ({ kind, text: HOLDS[kind] }))(holdKind(reason, address));
}

function holdKind(reason: string | null, address: Parameters<typeof holdState>[1]): HoldState["kind"] {
  if (reason === "funds" || reason === "setup") return reason;
  // paused, retry and not_allowed are ours; with another gift unconfirmed the hold's reason can't be read.
  if (reason !== "address" || address === null) return "waiting";
  if (!address.toPerson) return "cancel_only";
  // The daily look places one whose address is now shared, but an own address only on saving it.
  if (address.shared) return "waiting";
  return address.own && !address.rejected ? "check_address" : "address";
}

type HeldOrder = { status: string; failureType: string | null; ideaId: string; shipTo: string };

/**
 * What the orders say about an address hold. The store refusing an address ends one order and holds
 * another for the same idea, with no address of its own; one going to the buyer or elsewhere then has
 * nowhere to be changed.
 */
export function heldAddress(orders: HeldOrder[]): { rejected: boolean; toPerson: boolean } {
  const refused = orders.filter(
    (h) => h.status === "held" && orders.some((o) => o.ideaId === h.ideaId && o.failureType === "invalid_shipping_address"),
  );
  return { rejected: refused.some((h) => h.shipTo === "recipient"), toPerson: refused.every((h) => h.shipTo === "recipient") };
}

/** Whether a round is at a point where it has no ideas yet. */
export const beforeIdeas = (status: string) => NO_IDEAS_YET.has(status);

/**
 * What an open round with no ideas yet is doing: looking for them; told that none were found (the
 * no-ideas email, and no idea since); or needing the person's address. Null otherwise, and without
 * paid features, when nothing is looked for.
 */
export function waitingOn(o: {
  status: string;
  paid: boolean;
  hasAddress: boolean;
  toldAt: string | null;
  ideasFoundAt: string[];
}): "looking" | "told" | "address" | null {
  if (!beforeIdeas(o.status) || !o.paid) return null;
  const { toldAt } = o;
  // The round itself only moves at the next daily tick, so its status can lag a saved address.
  const addressed = o.status === "generating" || o.hasAddress;
  if (!addressed && (o.status === "needs_address" || toldAt === null)) return "address";
  if (toldAt !== null && o.ideasFoundAt.every((at) => Date.parse(at) < Date.parse(toldAt))) return "told";
  return addressed ? "looking" : "address";
}
