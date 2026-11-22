// The round screen's writes and reads (ALL-29 Task 9): "None of these" (AC-12, AC-13a), a budget
// typed on an open round (AC-9), and what the page shows (AC-3, AC-18, AC-29, AC-30, AC-30a).
// Writes go through the money-path SQL under the round lease, on the service-role client in
// deps.db; the page reads with the signed-in user's client, so RLS applies (T26). roundAccess is
// the only service-role read, and it says nothing but whose round it is.
import {
  FACT_VALUE_MAX,
  nextBestIdea,
  rejectionFacts,
  type CalendarDate,
  type Database,
  type RejectionCode,
  type RejectionFact,
} from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "@/lib/log";
import { storeName } from "@/modules/lists";
import { isId } from "../profile/rules";
import { claimRoundNow, concierge, fail, withLease } from "../purchase/store";
import type { ZincDeps } from "../zinc/types";
import { createSupabaseRoundStore } from "./store";

type UserDb = SupabaseClient<Database>;

// ─── rejecting ───────────────────────────────────────────────────────────────

type OfferedIdea = { id: string; title: string; source: "generated" | "list" };

/** The round's ideas still on offer: the ones reject_round_ideas would reject. */
async function offeredIdeas(deps: ZincDeps, roundId: string): Promise<OfferedIdea[]> {
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
 * Whether this choice still brings new ideas (runs_after_rejection), so the sheet says
 * "No more new ideas this time" for exactly that choice (AC-13a). Null when the owned idea isn't
 * one of the round's offered ideas. The caller has checked the round is the buyer's.
 */
export async function rejectionOutlook(
  input: { roundId: string; code: RejectionCode; text: string | null; ownedIdeaId: string | null },
  deps: ZincDeps,
): Promise<boolean | null> {
  const facts = factsFor(await offeredIdeas(deps, input.roundId), input.code, input.text, input.ownedIdeaId);
  if (facts === null) return null;
  const { data, error } = await concierge(deps).rpc("runs_after_rejection", {
    p_round_id: input.roundId,
    p_facts: facts,
    p_now: deps.now.toISOString(),
  });
  if (error) fail("Reading the rejection outlook failed", error);
  return data === true;
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
export type RejectResult = { ok: true; more: boolean } | { ok: false; error: "not_found" | "busy" | "not_open" | "changed" | "too_long" };

type OwnedRound = { id: string; user_id: string; person_id: string; occasion_id: string; status: string; budget_cents: number | null; closed_at: string | null };

async function ownRound(deps: ZincDeps, roundId: string, userId: string): Promise<OwnedRound | null> {
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
export async function rejectRoundIdeas(input: RejectInput, deps: ZincDeps): Promise<RejectResult> {
  const { userId, roundId, code } = input;
  const text = input.text?.trim() || null;
  if (text && text.length > FACT_VALUE_MAX) return { ok: false, error: "too_long" };

  const round = await ownRound(deps, roundId, userId);
  if (!round) return { ok: false, error: "not_found" };
  if (!isOpen(round)) return { ok: false, error: "not_open" };

  const lock = await claimRoundNow(deps, roundId);
  if (!lock) return { ok: false, error: "busy" };

  return withLease(deps, roundId, lock, async (): Promise<RejectResult> => {
    const ideas = await offeredIdeas(deps, roundId);
    const facts = factsFor(ideas, code, text, input.ownedIdeaId);
    if (facts === null) return { ok: false, error: "not_found" };
    const { error } = await concierge(deps).rpc("reject_round_ideas", {
      p_round_id: roundId,
      p_user_id: userId,
      p_lock: lock,
      p_reason_code: code,
      p_reason_text: text as string,
      p_facts: facts,
      p_expect_more: input.expectMore,
    });
    if (error) {
      const why = refusal(error, "reject_round_ideas");
      if (why === "changed") return { ok: false, error: "changed" };
      if (why === "not open" || why === "live order") return { ok: false, error: "not_open" };
      if (why === "lease not held") return { ok: false, error: "busy" };
      if (error.code === "23514") return { ok: false, error: "too_long" };
      fail("Rejecting the round's ideas failed", error);
    }
    logEvent(input.expectMore ? "round.ideas_rejected" : "round.rejection_noted", {
      round_id: roundId,
      user_id: userId,
      reason_code: code,
      // Ideas rejected: none when there's no search left (they stay buyable).
      count: input.expectMore ? ideas.length : 0,
    });
    return { ok: true, more: input.expectMore };
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
  deps: ZincDeps,
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
export async function roundAccess(roundId: string, viewerId: string, deps: ZincDeps): Promise<"mine" | "other" | "missing"> {
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
};

export type RoundPageOrder = {
  id: string;
  ideaId: string;
  title: string;
  status: string;
  failureType: string | null;
  totalCents: number | null;
  maxPriceCents: number;
  feeCents: number;
  estDeliveryDate: CalendarDate | null;
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
  };
  overBudgetPct: number | null;
  ideas: RoundPageIdea[];
  /** Orders that aren't cancelled or failed. */
  liveOrders: RoundPageOrder[];
  /** Failed orders still to fix: not yet replaced, and their round still open. */
  failedOrders: RoundPageOrder[];
  /** What happened, for a round that's no longer open (AC-18); null while it is. */
  closedText: string | null;
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
async function personList(userDb: UserDb, personId: string): Promise<ListItem[] | null> {
  const { data, error } = await userDb.schema("lists").rpc("person_list", { p_person_id: personId });
  if (error) {
    // The person was deleted: nothing of theirs is shared any more.
    if (error.code === "P0002") return null;
    fail("Reading the person's list failed", error);
  }
  if (data === null) return null;
  return ListShape.parse(data).items;
}

const ORDERED_STATUSES = new Set(["ordered", "delivered", "complete"]);
// Not given, as concierge.order_is_given counts it (failed ones are split out below).
const NOT_LIVE = new Set(["cancelled", "failed", "refunded"]);

/**
 * The round screen's read, with the signed-in user's client: null when RLS hides the round
 * (it's someone else's, or gone). `now` is for "today" (UTC, like the tick).
 */
export async function roundView(roundId: string, userDb: UserDb, now: Date): Promise<RoundPageView | null> {
  if (!isId(roundId)) return null;
  const db = userDb.schema("concierge");
  const round = await db
    .from("gift_rounds")
    .select("id, user_id, person_id, occasion_id, occasion_date, ship_by_deadline, budget_cents, status, attention_reason, closed_at")
    .eq("id", roundId)
    .maybeSingle();
  if (round.error) fail("Loading the round failed", round.error);
  const r = round.data;
  if (!r) return null;

  const [ideasRes, ordersRes, account, person, occasion, list, schedule] = await Promise.all([
    db
      .from("gift_ideas")
      .select(
        "id, title, reason, retailer, product_url, image_url, source, list_item_id, price_cents, est_total_cents, over_budget, rank, status, arrive_by, handling_days_max, delivery_days_max",
      )
      .eq("round_id", roundId)
      .order("rank"),
    db
      .from("orders")
      .select("id, idea_id, status, failure_type, resolved, total_cents, max_price_cents, fee_cents, est_delivery_date, created_at")
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
      claimed: item !== undefined && item.claimed && !item.claimed_by_me,
      claimedByMe: item !== undefined && item.claimed_by_me,
      // Off the list the buyer sees now, as lists.item_shared counts it.
      noLongerShared: i.list_item_id !== null && item === undefined,
    };
  });

  const titleOf = new Map(ideas.map((i) => [i.id, i.title]));
  // A failure already dealt with (replaced, or its round closed) is nothing to fix.
  const current = ordersRes.data.filter((o) => !(o.status === "failed" && o.resolved));
  const orders: RoundPageOrder[] = current.map((o) => ({
    id: o.id,
    ideaId: o.idea_id,
    title: titleOf.get(o.idea_id) ?? "",
    status: o.status,
    failureType: o.failure_type,
    totalCents: o.total_cents,
    maxPriceCents: o.max_price_cents,
    feeCents: o.fee_cents,
    estDeliveryDate: o.est_delivery_date,
  }));
  const liveOrders = orders.filter((o) => !NOT_LIVE.has(o.status));
  const failedOrders = orders.filter((o) => o.status === "failed");

  const today = now.toISOString().slice(0, 10);
  const pastDeadline = today > r.ship_by_deadline;
  let closedText: string | null = null;
  if (ORDERED_STATUSES.has(r.status) && liveOrders.length > 0) closedText = `Already ordered: ${liveOrders.map((o) => o.title).join(", ")}`;
  else if (r.closed_at !== null || r.status === "skipped" || ORDERED_STATUSES.has(r.status) || pastDeadline)
    closedText = "This occasion has passed";

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
      imageUrl: i.image_url ?? null,
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
    },
    overBudgetPct: account.data?.over_budget_pct ?? null,
    ideas,
    liveOrders,
    failedOrders,
    closedText,
    nextBestIdeaId,
    buyYourself,
  };
}
