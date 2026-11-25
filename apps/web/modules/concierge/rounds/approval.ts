// The round screen's writes and reads (ALL-29 Task 9): "None of these" (AC-12, AC-13a), a budget
// typed on an open round (AC-9), and what the page shows (AC-3, AC-18, AC-29, AC-30, AC-30a).
// Writes go through the money-path SQL under the round lease, on the service-role client in
// deps.db; the page reads with the signed-in user's client, so RLS applies (T26). roundAccess is
// the only service-role read, and it says nothing but whose round it is.
import {
  FACT_VALUE_MAX,
  isShippableAddress,
  nextBestIdea,
  packagesFromZinc,
  rejectionFactKey,
  rejectionFacts,
  type CalendarDate,
  type Database,
  type RejectionCode,
  type RejectionFact,
  type TrackedPackage,
} from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isSensitive } from "@/lib/ai/sensitive";
import { errorFields, logEvent } from "@/lib/log";
import type { Restored } from "@/lib/restored-ideas";
import { storeName } from "@gifts-af/core/store-page/link";
import { hasPaidFeatures } from "../paid-features";
import { isId } from "../profile/rules";
import { listGiftCandidates } from "../ideas/store";
import { claimRoundNow, concierge, fail, withLease } from "../purchase/store";
import type { DbDeps } from "../zinc/types";
import type { HoldGate } from "./hold-gate";
import { aboutOrders, beforeIdeas, heldAddress, holdState, roundOutcome, waitingOn, type Closed, type HoldState } from "./outcome";
import { createSupabaseRoundStore, readRestored } from "./store";

type UserDb = SupabaseClient<Database>;

// ─── rejecting ───────────────────────────────────────────────────────────────

type OfferedIdea = { id: string; title: string; source: "generated" | "list" };

/** The round's ideas still on offer: the ones reject_round_ideas would reject. */
async function offeredIdeas(deps: DbDeps, roundId: string): Promise<OfferedIdea[]> {
  const { data, error } = await concierge(deps)
    .from("gift_ideas")
    .select("id, title, source")
    .eq("round_id", roundId)
    .in("status", ["proposed", "selected"])
    .order("rank");
  if (error) fail("Loading the round's ideas failed", error);
  return (data ?? []).map((i) => ({ id: i.id, title: i.title, source: i.source === "list" ? "list" : "generated" }));
}

/** The facts this choice would save; null when the owned idea isn't one of the round's. */
function factsFor(ideas: OfferedIdea[], code: RejectionCode, text: string | null, ownedIdeaId: string | null): RejectionFact[] | null {
  const owned = ownedIdeaId === null ? null : (ideas.find((i) => i.id === ownedIdeaId) ?? null);
  if (ownedIdeaId !== null && owned === null) return null;
  return rejectionFacts(code, text, ideas, owned);
}

/**
 * Whether the person's list has a gift a new run in this round could offer: listGiftCandidates
 * leaves out the ones this round already offered, which "None of these" would reject.
 */
async function listGiftsLeft(deps: DbDeps, roundId: string, personId: string): Promise<boolean> {
  return (await listGiftCandidates(deps.db, personId, roundId)).length > 0;
}

/** What a reason will do, for the sheet to say before sending (AC-13a). */
export type RejectionOutlook = {
  /** New ideas are looked for; otherwise "No more new ideas this time". */
  more: boolean;
  /** It leaves a fact the next ideas use. */
  saves: boolean;
  /** The next ideas must cost less: only AI ideas set that limit (roundCeiling). */
  cheaper: boolean;
};

/**
 * Whether saving these leaves the reason in use: the typed one when there is one (it's always the
 * last fact), otherwise any. A fact the buyer removed stays removed (reject_round_ideas).
 */
async function savesReason(deps: DbDeps, personId: string, facts: RejectionFact[], text: string | null): Promise<boolean> {
  const mine = text?.trim() ? facts.filter((f) => f.category === "avoid").slice(-1) : facts;
  if (mine.length === 0) return false;
  const { data, error } = await concierge(deps)
    .from("profile_facts")
    .select("category, value")
    .eq("person_id", personId)
    .eq("active", false)
    .in("category", ["owns", "avoid"]);
  if (error) fail("Reading the removed facts failed", error);
  const removed = new Set((data ?? []).map(rejectionFactKey));
  return mine.some((f) => !removed.has(rejectionFactKey(f)));
}

/**
 * What this choice will do: whether it still brings new ideas (runs_after_rejection), and what it
 * saves. Null when the owned idea isn't one of the round's offered ideas. The caller has checked
 * the round is the buyer's.
 */
export async function rejectionOutlook(
  input: { roundId: string; code: RejectionCode; text: string | null; ownedIdeaId: string | null },
  deps: DbDeps,
): Promise<RejectionOutlook | null> {
  const ideas = await offeredIdeas(deps, input.roundId);
  const facts = factsFor(ideas, input.code, input.text, input.ownedIdeaId);
  if (facts === null) return null;
  const round = await concierge(deps).from("gift_rounds").select("person_id").eq("id", input.roundId).maybeSingle();
  if (round.error) fail("Loading the round failed", round.error);
  if (!round.data) return null;
  const { data, error } = await concierge(deps).rpc("runs_after_rejection", {
    p_round_id: input.roundId,
    p_facts: facts,
    p_now: deps.now.toISOString(),
    p_list_gifts: await listGiftsLeft(deps, input.roundId, round.data.person_id),
  });
  if (error) fail("Reading the rejection outlook failed", error);
  return {
    more: data === true,
    saves: await savesReason(deps, round.data.person_id, facts, input.text),
    cheaper: input.code === "too_pricey" && ideas.some((i) => i.source === "generated"),
  };
}

export type RejectInput = {
  userId: string;
  roundId: string;
  code: RejectionCode;
  text: string | null;
  ownedIdeaId: string | null;
  /** What the sheet showed: true for new ideas, false for "No more new ideas this time". */
  expectMore: boolean;
};
export type RejectResult = { ok: true; more: boolean; saved: boolean } | { ok: false; error: "not_found" | "busy" | "not_open" | "changed" | "too_long" | "sensitive" };

type OwnedRound = { id: string; user_id: string; person_id: string; occasion_id: string; status: string; budget_cents: number | null; closed_at: string | null };

async function ownRound(deps: DbDeps, roundId: string, userId: string): Promise<OwnedRound | null> {
  if (!isId(roundId)) return null;
  const { data, error } = await concierge(deps)
    .from("gift_rounds")
    .select("id, user_id, person_id, occasion_id, status, budget_cents, closed_at")
    .eq("id", roundId)
    .maybeSingle();
  if (error) fail("Loading the round failed", error);
  return data && data.user_id === userId ? (data as OwnedRound) : null;
}

const isOpen = (r: OwnedRound) => r.status === "awaiting_approval" && r.closed_at === null;

/** The part of a P0001 refusal after "<function>: ". */
function refusal(error: { message: string; code?: string }, fn: string): string | null {
  return error.code === "P0001" && error.message.startsWith(`${fn}: `) ? error.message.slice(fn.length + 2) : null;
}

/**
 * "None of these" (AC-12, AC-13a), under the round lease. With a search left the round's ideas
 * are rejected and it goes back to generating, due now: the next tick runs ideas, so this
 * doesn't call advanceRound. With none left only the reason and its facts are saved.
 */
export async function rejectRoundIdeas(input: RejectInput, deps: DbDeps): Promise<RejectResult> {
  const { userId, roundId, code } = input;
  const text = input.text?.trim() || null;
  if (text && text.length > FACT_VALUE_MAX) return { ok: false, error: "too_long" };
  // The reason becomes a fact the next ideas use, so it gets the same check as any typed fact.
  if (text && isSensitive(text)) return { ok: false, error: "sensitive" };

  const round = await ownRound(deps, roundId, userId);
  if (!round) return { ok: false, error: "not_found" };
  if (!isOpen(round)) return { ok: false, error: "not_open" };

  const lock = await claimRoundNow(deps, roundId);
  if (!lock) return { ok: false, error: "busy" };

  return withLease(deps, roundId, lock, async (): Promise<RejectResult> => {
    const ideas = await offeredIdeas(deps, roundId);
    const facts = factsFor(ideas, code, text, input.ownedIdeaId);
    if (facts === null) return { ok: false, error: "not_found" };
    // Only words on the page, so a failed read never blocks rejecting: it says nothing was saved.
    const saved = await savesReason(deps, round.person_id, facts, text).catch((err: unknown) => {
      logEvent("round.saved_unreadable", { round_id: roundId, user_id: userId, ...errorFields(err) });
      return false;
    });
    const call = {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_reason_code: code,
      p_reason_text: text as string,
      p_facts: facts,
      p_expect_more: input.expectMore,
      p_list_gifts: await listGiftsLeft(deps, roundId, round.person_id),
    };
    const reject = (args: typeof call & { p_owned_idea_id?: string }) => concierge(deps).rpc("reject_round_ideas", args);
    let { error } = await reject(input.ownedIdeaId === null ? call : { ...call, p_owned_idea_id: input.ownedIdeaId });
    // A database without that argument yet (PostgREST's "no such function"): the call it knows.
    if (error?.code === "PGRST202" && input.ownedIdeaId !== null) ({ error } = await reject(call));
    if (error) {
      const why = refusal(error, "reject_round_ideas");
      if (why === "changed") return { ok: false, error: "changed" };
      if (why === "not open" || why === "live order") return { ok: false, error: "not_open" };
      if (why === "lease not held") return { ok: false, error: "busy" };
      // Only the fact-length rule means the reason was too long; any other
      // check failing here is a bug and must surface as one.
      if (error.code === "23514" && error.message.includes("profile_facts_value_check")) {
        return { ok: false, error: "too_long" };
      }
      fail("Rejecting the round's ideas failed", error);
    }
    logEvent(input.expectMore ? "round.ideas_rejected" : "round.rejection_noted", {
      round_id: roundId,
      user_id: userId,
      reason_code: code,
      // Ideas rejected: none when there's no search left (they stay buyable).
      count: input.expectMore ? ideas.length : 0,
    });
    return { ok: true, more: input.expectMore, saved };
  });
}

// ─── the open round's budget ─────────────────────────────────────────────────

/**
 * A budget typed on a round that has none (AC-9), under the round's lease: set on the round first
 * (which marks each idea over the budget or not), so a refusal leaves everything as it was, then
 * saved as the person's budget for the round's occasion (save_budgets, as the user, so RLS applies).
 */
export async function setRoundBudget(
  input: { userId: string; roundId: string; budgetCents: number },
  userDb: UserDb,
  deps: DbDeps,
): Promise<"saved" | "busy" | "already_set" | "not_open"> {
  const { userId, roundId, budgetCents } = input;
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0) throw new Error("A budget is a whole number of cents, 0 or more.");

  const round = await ownRound(deps, roundId, userId);
  if (!round || !isOpen(round)) return "not_open";
  if (round.budget_cents !== null) return "already_set";

  const occasion = await concierge(deps).from("occasions").select("kind").eq("id", round.occasion_id).maybeSingle();
  if (occasion.error) fail("Loading the round's occasion failed", occasion.error);
  const kind = occasion.data?.kind;
  if (!kind) return "not_open";

  const lock = await claimRoundNow(deps, roundId);
  if (!lock) return "busy";

  return withLease(deps, roundId, lock, async () => {
    const { error } = await concierge(deps).rpc("set_round_budget", {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_budget_cents: budgetCents,
    });
    if (error) {
      const why = refusal(error, "set_round_budget");
      if (why === "already set") return "already_set";
      if (why === "not open") return "not_open";
      if (why === "lease not held") return "busy";
      fail("Setting the round's budget failed", error);
    }
    const saved = await userDb.schema("concierge").rpc("save_budgets", {
      p_person_id: round.person_id,
      p_amounts: { [kind]: budgetCents },
    });
    if (saved.error) fail("Saving the person's budget failed", saved.error);
    logEvent("round.budget_set", { round_id: roundId, user_id: userId, cents: budgetCents });
    return "saved";
  });
}

// ─── page reads ──────────────────────────────────────────────────────────────

/** Whose round this is, and nothing else (AC-3, S4): the only service-role read for the page. */
export async function roundAccess(roundId: string, viewerId: string, deps: DbDeps): Promise<"mine" | "other" | "missing"> {
  if (!isId(roundId)) return "missing";
  const { data, error } = await concierge(deps).from("gift_rounds").select("user_id").eq("id", roundId).maybeSingle();
  if (error) fail("Loading the round failed", error);
  if (!data) return "missing";
  return data.user_id === viewerId ? "mine" : "other";
}

export type RoundPageIdea = {
  id: string;
  title: string;
  reason: string | null;
  retailer: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  source: "generated" | "list";
  listItemId: string | null;
  priceCents: number;
  totalCents: number;
  overBudget: boolean;
  rank: number;
  status: string;
  arriveBy: CalendarDate | null;
  /** A list gift someone else has claimed: greyed out, can't be picked (AC-30). */
  claimed: boolean;
  /**
   * A list gift this buyer holds the claim on: on one of their live orders, here or in another
   * round, so the screen greys it out unless it's this round's own order (AC-30).
   */
  claimedByMe: boolean;
  /** A list gift whose list the buyer can no longer see: can't be picked (AC-30a). */
  noLongerShared: boolean;
  /** Zinc can price it today (it has a product id), so the fix page may offer "Check today's price" (AC-14). */
  livePrice: boolean;
};

export type RoundPageOrder = {
  id: string;
  ideaId: string;
  title: string;
  status: string;
  failureType: string | null;
  totalCents: number | null;
  /** What Zinc refunded when the store cancelled; null otherwise or when Zinc didn't say. */
  refundCents: number | null;
  maxPriceCents: number;
  feeCents: number;
  estDeliveryDate: CalendarDate | null;
  /** When Zinc placed it, for the store's own range when there's no carrier estimate. */
  placedAt: string | null;
  deliveredAt: string | null;
  packages: TrackedPackage[];
  /** The idea's store range, in days. */
  handlingDaysMax: number | null;
  deliveryDaysMax: number | null;
};

/** A list gift that isn't among the ideas, for "Buy it yourself" (AC-29). */
export type BuyYourself = {
  itemId: string;
  name: string;
  productUrl: string | null;
  storeName: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  claimed: boolean;
  claimedByMe: boolean;
};

export type RoundPageView = {
  round: {
    id: string;
    personId: string;
    personName: string | null;
    occasionId: string;
    occasionKind: string | null;
    occasionDate: CalendarDate;
    shipByDeadline: CalendarDate;
    budgetCents: number | null;
    status: string;
    attentionReason: string | null;
    /** UTC, like the tick. */
    today: CalendarDate;
  };
  overBudgetPct: number | null;
  ideas: RoundPageIdea[];
  /** Orders that aren't cancelled or failed, delivered ones included. */
  liveOrders: RoundPageOrder[];
  /** Failed orders still to fix: not yet replaced, and their round still open. */
  failedOrders: RoundPageOrder[];
  /**
   * Gifts the store cancelled, resolved or not, so one cancelled on or after the ship-by date
   * (resolved at once, so not in failedOrders) still shows with its refund.
   */
  storeCancelled: RoundPageOrder[];
  /** What happened, for a round that's no longer open (AC-18); null while it is. */
  closedText: string | null;
  /**
   * What an open round with no ideas yet is doing: looking for them; told that none were found (the
   * no-ideas email, and no idea since); or needing the person's address. Null otherwise, and without
   * paid features, when nothing is looked for.
   */
  waiting: "looking" | "told" | "address" | null;
  /** Why an open round's held gifts wait, and which of them it's about; null with none. */
  hold: (HoldState & { orderIds: string[] }) | null;
  /** The ideas on offer came back after "None of these", and how that search ended; null otherwise. */
  restored: Restored | null;
  nextBestIdeaId: string | null;
  buyYourself: BuyYourself[];
};

// person_list's items (T19): the concierge reads list gifts only through it.
const ListShape = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price_cents: z.number().nullable().optional(),
      image_url: z.string().nullable().optional(),
      product_url: z.string().nullable().optional(),
      claimed: z.boolean(),
      claimed_by_me: z.boolean(),
    }),
  ),
});
type ListItem = z.infer<typeof ListShape>["items"][number];

/** The person's linked list as the buyer sees it now, or null when it's no longer shared. */
export async function personList(userDb: UserDb, personId: string): Promise<ListItem[] | null> {
  const { data, error } = await userDb.schema("lists").rpc("person_list", { p_person_id: personId });
  if (error) {
    // The person was deleted: nothing of theirs is shared any more.
    if (error.code === "P0002") return null;
    fail("Reading the person's list failed", error);
  }
  if (data === null) return null;
  return ListShape.parse(data).items;
}

/** Whether the buyer can still get a list gift, going by the list as they see it now. */
export const listState = (itemId: string | null, item: ListItem | undefined) => ({
  claimed: item !== undefined && item.claimed && !item.claimed_by_me,
  claimedByMe: item !== undefined && item.claimed_by_me,
  // Off the list the buyer sees now, as lists.item_shared counts it.
  noLongerShared: itemId !== null && item === undefined,
});

/**
 * Whether the list a person is linked to shares an address with the buyer. Only its city and state are
 * readable here (D38), so a shared address the engine would refuse as incomplete still counts.
 */
export async function sharesAddress(userDb: UserDb, personId: string): Promise<boolean> {
  const { data, error } = await userDb.rpc("shared_city_for_person", { p_person_id: personId });
  // The person was deleted: there is no one to ship to (as personList).
  if (error && error.code !== "P0002") fail("Reading the shared city failed", error);
  return error === null && data !== null;
}

type AddressRow = Pick<
  Database["public"]["Tables"]["people"]["Row"],
  "recipient_first_name" | "recipient_last_name" | "address_line1" | "address_line2" | "city" | "state" | "zip" | "country"
>;

/** Whether a person's own saved address could be shipped to. */
export const ownAddressShips = (p: AddressRow) =>
  isShippableAddress({
    firstName: p.recipient_first_name,
    lastName: p.recipient_last_name,
    line1: p.address_line1,
    line2: p.address_line2,
    city: p.city,
    state: p.state,
    zip: p.zip,
    country: p.country,
  });

/** Whether the address saved on the person could be shipped to. */
async function ownAddress(userDb: UserDb, personId: string): Promise<boolean> {
  const { data, error } = await userDb
    .from("people")
    .select("recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country")
    .eq("id", personId)
    .maybeSingle();
  if (error) fail("Reading the person's address failed", error);
  return data !== null && ownAddressShips(data);
}

/** Whether a gift could ship to the person: a usable address of their own, or one shared through their list. */
async function hasAddress(userDb: UserDb, personId: string): Promise<boolean> {
  const [own, shared] = await Promise.all([ownAddress(userDb, personId), sharesAddress(userDb, personId)]);
  return own || shared;
}

/**
 * What a round with no ideas yet is waiting on (RoundPageView.waiting). Only words on the page, so a
 * failed read is logged and says nothing: the buy and fix pages read the same view.
 */
async function readWaiting(
  userDb: UserDb,
  r: { id: string; user_id: string; person_id: string; status: string; ship_by_deadline: CalendarDate },
  ideasFoundAt: string[],
): Promise<ReturnType<typeof waitingOn>> {
  let needsAddress = false;
  try {
    if (!(await hasPaidFeatures(userDb, r.user_id))) return null;
    const addressed = r.status === "generating" || (await hasAddress(userDb, r.person_id));
    needsAddress = r.status === "needs_address" && !addressed;
    const told = await userDb
      .schema("concierge")
      .from("notifications")
      .select("sent_at")
      .eq("round_id", r.id)
      .eq("kind", "no_ideas")
      .eq("channel", "email")
      .not("sent_at", "is", null)
      .is("error", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (told.error) fail("Reading the round's no-ideas email failed", told.error);
    return waitingOn({ status: r.status, paid: true, hasAddress: addressed, toldAt: told.data?.sent_at ?? null, ideasFoundAt, shipBy: r.ship_by_deadline });
  } catch (err) {
    logEvent("round_waiting_failed", { round_id: r.id, user_id: r.user_id, ...errorFields(err) });
    // A failed read of the told email never hides "Add address".
    return needsAddress ? "address" : null;
  }
}

/** Why the round's held gifts wait, by what's so now; a failed read is logged and asks nothing of the buyer. */
async function readHold(
  userDb: UserDb,
  r: { id: string; user_id: string; person_id: string; attention_reason: string | null },
  orders: Parameters<typeof heldAddress>[0],
  readGate: (() => Promise<HoldGate>) | undefined,
): Promise<HoldState> {
  const reason = r.attention_reason;
  try {
    const [gate, own, shared] = await Promise.all([
      readGate ? readGate() : null,
      reason === "address" && ownAddress(userDb, r.person_id),
      reason === "address" && sharesAddress(userDb, r.person_id),
    ]);
    return holdState(reason, gate, { own, shared, ...heldAddress(orders) });
  } catch (err) {
    logEvent("round_hold_failed", { round_id: r.id, user_id: r.user_id, ...errorFields(err) });
    return holdState(reason, null, null);
  }
}

const CLOSED_TEXT: Record<Exclude<Closed, "ordered">, string> = {
  moved: "The date changed, so this round ended.",
  confirming: "We're still confirming your order.",
  passed: "This occasion has passed",
  none_coming: "No gift is on its way",
  too_late: "It's too late to send a gift in time",
  stopped: "This gift round was stopped",
};

/** RoundPageView.restored. Only words on the page, so a failed read is logged and says nothing, as waitingOn. */
async function restoredIdeas(userDb: UserDb, r: { id: string; user_id: string }, ideaIds: string[]): Promise<Restored | null> {
  try {
    return await readRestored(userDb, r.id, ideaIds);
  } catch (err) {
    logEvent("round_restored_unreadable", { round_id: r.id, user_id: r.user_id, ...errorFields(err) });
    return null;
  }
}

/**
 * The round screen's read, with the signed-in user's client: null when RLS hides the round
 * (it's someone else's, or gone). `now` is for "today" (UTC, like the tick). `gate` reads what placing
 * checks, only when a gift is held; without it a hold asks nothing of the buyer.
 */
export async function roundView(roundId: string, userDb: UserDb, now: Date, gate?: () => Promise<HoldGate>): Promise<RoundPageView | null> {
  if (!isId(roundId)) return null;
  const db = userDb.schema("concierge");
  const round = await db
    .from("gift_rounds")
    .select("id, user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, attention_reason, closed_at")
    .eq("id", roundId)
    .maybeSingle();
  if (round.error) fail("Loading the round failed", round.error);
  const r = round.data;
  if (!r) return null;

  const [ideasRes, ordersRes, account, person, occasion, list, schedule] = await Promise.all([
    db
      .from("gift_ideas")
      .select(
        "id, title, reason, retailer, retailer_product_id, product_url, image_url, source, list_item_id, price_cents, est_total_cents, over_budget, rank, status, arrive_by, handling_days_max, delivery_days_max, created_at",
      )
      .eq("round_id", roundId)
      .order("rank"),
    db
      .from("orders")
      .select(
        "id, idea_id, status, failure_type, resolved, ship_to, total_cents, refund_cents, max_price_cents, fee_cents, est_delivery_date, placed_at, delivered_at, packages, created_at",
      )
      .eq("round_id", roundId)
      .order("created_at")
      .order("id"),
    db.from("accounts").select("over_budget_pct").eq("user_id", r.user_id).maybeSingle(),
    userDb.from("people").select("name").eq("id", r.person_id).maybeSingle(),
    db.from("occasions").select("kind").eq("id", r.occasion_id).maybeSingle(),
    personList(userDb, r.person_id),
    createSupabaseRoundStore(userDb).scheduleSettings(),
  ]);
  if (ideasRes.error) fail("Loading the round's ideas failed", ideasRes.error);
  if (ordersRes.error) fail("Loading the round's orders failed", ordersRes.error);
  if (account.error) fail("Reading the account failed", account.error);
  if (person.error) fail("Loading the round's person failed", person.error);
  if (occasion.error) fail("Loading the round's occasion failed", occasion.error);

  const items = new Map((list ?? []).map((i) => [i.id, i]));
  const ideas: RoundPageIdea[] = ideasRes.data.map((i) => {
    const item = i.list_item_id ? items.get(i.list_item_id) : undefined;
    return {
      id: i.id,
      title: i.title,
      reason: i.reason,
      retailer: i.retailer,
      productUrl: i.product_url,
      imageUrl: i.image_url,
      source: i.source === "list" ? "list" : "generated",
      listItemId: i.list_item_id,
      priceCents: i.price_cents,
      totalCents: i.est_total_cents,
      overBudget: i.over_budget,
      rank: i.rank,
      status: i.status,
      arriveBy: i.arrive_by,
      ...listState(i.list_item_id, item),
      livePrice: i.retailer_product_id !== null,
    };
  });

  const ideaOf = new Map(ideasRes.data.map((i) => [i.id, i]));
  const all = ordersRes.data.map((o): RoundPageOrder & { resolved: boolean } => {
    const idea = ideaOf.get(o.idea_id);
    return {
      id: o.id,
      ideaId: o.idea_id,
      title: idea?.title ?? "",
      status: o.status,
      failureType: o.failure_type,
      resolved: o.resolved,
      totalCents: o.total_cents,
      refundCents: o.refund_cents,
      maxPriceCents: o.max_price_cents,
      feeCents: o.fee_cents,
      estDeliveryDate: o.est_delivery_date,
      placedAt: o.placed_at,
      deliveredAt: o.delivered_at,
      // Stored whitelisted (T42); read through the same whitelist.
      packages: packagesFromZinc(o.packages),
      handlingDaysMax: idea?.handling_days_max ?? null,
      deliveryDaysMax: idea?.delivery_days_max ?? null,
    };
  });
  const today = now.toISOString().slice(0, 10);
  const outcome = roundOutcome(
    { status: r.status, closedAt: r.closed_at, shipBy: r.ship_by_deadline, occasionDate: r.occasion_date, occasionYear: r.occasion_year },
    all,
    today,
  );
  const { live: liveOrders, failed: failedOrders, storeCancelled, closed } = outcome;
  const closedByOutcome =
    closed === null ? null : closed === "ordered" ? `Already ordered: ${outcome.bought.map((o) => o.title).join(", ")}` : CLOSED_TEXT[closed];

  const waitingFor = closed === null && beforeIdeas(r.status) ? await readWaiting(userDb, r, ideasRes.data.map((i) => i.created_at)) : null;
  // Told it's too late: nothing more is looked for, so it reads as it will once its deadline closes it.
  const closedText = waitingFor === "too_late" ? CLOSED_TEXT.too_late : closedByOutcome;
  const waiting = waitingFor === "too_late" ? null : waitingFor;

  let hold: RoundPageView["hold"] = null;
  if (closed === null && liveOrders.some((o) => o.status === "held")) {
    const orders = ordersRes.data.map((o) => ({ id: o.id, status: o.status, failureType: o.failure_type, ideaId: o.idea_id, shipTo: o.ship_to }));
    const state = await readHold(userDb, r, orders, gate);
    hold = { ...state, orderIds: aboutOrders(state, orders) };
  }

  const restored =
    closedText === null && r.status === "awaiting_approval"
      ? await restoredIdeas(userDb, r, ideas.filter((i) => i.status === "proposed").map((i) => i.id))
      : null;

  const buyable = ideas.filter((i) => !i.claimed && !i.noLongerShared && !liveOrders.some((o) => o.ideaId === i.id));
  const nextBestIdeaId =
    closedText === null
      ? nextBestIdea(
          buyable.flatMap((i) => {
            const raw = ideasRes.data.find((x) => x.id === i.id)!;
            return raw.handling_days_max === null || raw.delivery_days_max === null
              ? []
              : [{ id: i.id, rank: i.rank, status: i.status, handlingDaysMax: raw.handling_days_max, deliveryDaysMax: raw.delivery_days_max }];
          }),
          { today, occasionDate: r.occasion_date, s: schedule },
        )
      : null;

  const onRound = new Set(ideas.flatMap((i) => (i.listItemId ? [i.listItemId] : [])));
  const buyYourself: BuyYourself[] = (list ?? [])
    .filter((i) => !onRound.has(i.id))
    .map((i) => ({
      itemId: i.id,
      name: i.name,
      productUrl: i.product_url ?? null,
      storeName: i.product_url ? storeName(i.product_url) : null,
      priceCents: i.price_cents ?? null,
      // https only, as idea photos are (AC-17): a list photo saved as a storage path or over http shows the gift icon.
      imageUrl: i.image_url?.startsWith("https://") ? i.image_url : null,
      claimed: i.claimed && !i.claimed_by_me,
      claimedByMe: i.claimed_by_me,
    }));

  return {
    round: {
      id: r.id,
      personId: r.person_id,
      personName: person.data?.name ?? null,
      occasionId: r.occasion_id,
      occasionKind: occasion.data?.kind ?? null,
      occasionDate: r.occasion_date,
      shipByDeadline: r.ship_by_deadline,
      budgetCents: r.budget_cents,
      status: r.status,
      attentionReason: r.attention_reason,
      today,
    },
    overBudgetPct: account.data?.over_budget_pct ?? null,
    ideas,
    liveOrders,
    failedOrders,
    storeCancelled,
    closedText,
    waiting,
    hold,
    restored,
    nextBestIdeaId,
    buyYourself,
  };
}
