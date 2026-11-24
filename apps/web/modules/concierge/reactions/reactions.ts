// How a gift went over: saving an answer, what the answer page shows, and a person's gift history.
// The save runs save_reaction on the service-role client in deps.db; every read uses the signed-in
// user's client, so RLS applies (T26). Whose round a link names is roundAccess's job.
import { RATINGS, reactionFact, type CalendarDate, type Database, type Rating, type RoundStatus } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitive } from "@/lib/ai/sensitive";
import { errorFields, logEvent } from "@/lib/log";
import { isId, SENSITIVE_REFUSAL } from "../profile/rules";
import { concierge, fail } from "../purchase/store";
import type { DbDeps } from "../zinc/types";

type Db = SupabaseClient<Database>;

/** The UTC day, as the tick counts days. */
const dayOf = (now: Date): CalendarDate => now.toISOString().slice(0, 10);

// ─── saving ──────────────────────────────────────────────────────────────────

const REFUSALS = {
  sensitive: SENSITIVE_REFUSAL,
  off: "Not available right now.",
  note_too_long: "That note is too long. Shorten it and save again.",
  not_found: "We couldn't find that gift. Reload and try again.",
  not_delivered: "You can say how it went once this gift has arrived.",
  too_early: "You can say how it went once the occasion has come.",
  failed: "That didn't save. Try again.",
} as const;
export type ReactionRefusal = keyof typeof REFUSALS;

/** save_reaction's own refusals that tell the buyer something; any other is a failure. */
const FROM_DATABASE = new Map<string, Exclude<ReactionRefusal, "failed">>([
  ["save_reaction: off", "off"],
  ["save_reaction: note too long", "note_too_long"],
  ["save_reaction: not found", "not_found"],
  ["save_reaction: not delivered", "not_delivered"],
  ["save_reaction: before the occasion", "too_early"],
]);

export type ReactionSaveResult =
  | { ok: true; roundId: string; personId: string; complete: boolean }
  | { ok: false; reason: ReactionRefusal; error: string };

/**
 * Saves the user's answer about one of their delivered gifts, or changes it. Someone else's order
 * answers exactly as one that doesn't exist.
 */
export async function saveReaction(
  input: { userId: string; orderId: string; rating: Rating; note: string | null },
  deps: DbDeps,
): Promise<ReactionSaveResult> {
  const { userId, orderId, rating } = input;
  // Forms post a line break as two characters; the limit counts it as one.
  const note = input.note?.replaceAll("\r\n", "\n").trim() || null;
  // A malformed id is the form's own text, so it isn't logged (E6).
  const ids: Record<string, string> = isId(orderId) ? { user_id: userId, order_id: orderId } : { user_id: userId };
  const refuse = (reason: Exclude<ReactionRefusal, "failed">): ReactionSaveResult => {
    logEvent("reaction.refused", { ...ids, reason });
    return { ok: false, reason, error: REFUSALS[reason] };
  };
  const failed = (error: unknown): ReactionSaveResult => {
    logEvent("reaction.save_failed", { ...ids, ...errorFields(error) });
    return { ok: false, reason: "failed", error: REFUSALS.failed };
  };

  if (!isId(orderId)) return refuse("not_found");
  if (note && isSensitive(note)) return refuse("sensitive");

  const found = await concierge(deps)
    .from("orders")
    .select("round_id, gift_rounds!inner(person_id), gift_ideas!inner(title, source)")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (found.error) return failed(found.error);
  const order = found.data;
  if (!order) return refuse("not_found");

  const fact = reactionFact(rating, { title: order.gift_ideas.title, fromList: order.gift_ideas.source === "list" }, note);
  // Checked as it would be saved: the title can trip the filter too.
  const kept = fact && !isSensitive(fact.value) ? fact : null;
  const args = {
    p_user_id: userId,
    p_order_id: orderId,
    p_rating: rating,
    // Null is valid for these three; the generated types don't know it.
    p_note: note as string,
    p_fact_category: (kept?.category ?? null) as string,
    p_fact_value: (kept?.value ?? null) as string,
    p_today: dayOf(deps.now),
  };
  let saved = await concierge(deps).rpc("save_reaction", args);
  // A deadlock wrote nothing, so it's safe to try once more.
  if (saved.error?.code === "40P01") saved = await concierge(deps).rpc("save_reaction", args);
  if (saved.error) {
    const reason = saved.error.code === "P0001" ? FROM_DATABASE.get(saved.error.message) : undefined;
    return reason ? refuse(reason) : failed(saved.error);
  }

  const personId = order.gift_rounds.person_id;
  const complete = saved.data === "complete";
  logEvent("reaction.saved", { ...ids, round_id: order.round_id, person_id: personId, complete });
  return { ok: true, roundId: order.round_id, personId, complete };
}

// ─── what's read back ────────────────────────────────────────────────────────

type Answer = { rating: Rating | null; note: string | null };

/** An order's answer: at most one row (reactions.order_id is unique). */
function answerOf(rows: { rating: string; note: string | null }[]): Answer {
  return { rating: RATINGS.find((r) => r === rows[0]?.rating) ?? null, note: rows[0]?.note ?? null };
}

export type ReactionView = {
  round: {
    id: string;
    personId: string;
    /** Null when the person was removed. */
    personName: string | null;
    /** Null when the occasion was removed. */
    occasionKind: string | null;
    occasionDate: CalendarDate;
    status: RoundStatus;
  };
  /** The delivered gifts, in the order they were bought. */
  gifts: ({ orderId: string; title: string; imageUrl: string | null } & Answer)[];
  /** Why answering isn't open; null when it is. save_reaction checks again. */
  closed: "off" | "too_early" | null;
  noteMaxChars: number;
};

/** The answer page's read, with the signed-in user's client: null when RLS hides the round, or it's gone. */
export async function reactionView(roundId: string, userDb: Db, now: Date): Promise<ReactionView | null> {
  if (!isId(roundId)) return null;
  const db = userDb.schema("concierge");
  const round = await db
    .from("gift_rounds")
    .select(
      "id, person_id, occasion_date, status, occasions(kind), orders(id, status, created_at, gift_ideas(title, image_url), reactions(rating, note))",
    )
    .eq("id", roundId)
    .eq("orders.status", "delivered")
    .order("created_at", { referencedTable: "orders" })
    .order("id", { referencedTable: "orders" })
    .maybeSingle();
  if (round.error) fail("Loading the round's gifts failed", round.error);
  const r = round.data;
  if (!r) return null;

  const [person, enabled, noteMax] = await Promise.all([
    userDb.from("people").select("name").eq("id", r.person_id).maybeSingle(),
    db.rpc("setting_int", { p_key: "reactions_enabled" }),
    db.rpc("setting_int", { p_key: "reaction_note_max_chars" }),
  ]);
  if (person.error) fail("Loading the round's person failed", person.error);
  if (enabled.error) fail("Reading setting reactions_enabled failed", enabled.error);
  if (noteMax.error) fail("Reading setting reaction_note_max_chars failed", noteMax.error);
  if (typeof noteMax.data !== "number") throw new Error("Setting reaction_note_max_chars is missing.");

  return {
    round: {
      id: r.id,
      personId: r.person_id,
      personName: person.data?.name ?? null,
      occasionKind: r.occasions?.kind ?? null,
      occasionDate: r.occasion_date,
      status: r.status,
    },
    gifts: r.orders.map((o) => ({
      orderId: o.id,
      title: o.gift_ideas.title,
      imageUrl: o.gift_ideas.image_url,
      ...answerOf(o.reactions),
    })),
    // A missing switch counts as off.
    closed: enabled.data !== 1 ? "off" : dayOf(now) < r.occasion_date ? "too_early" : null,
    noteMaxChars: noteMax.data,
  };
}

// ─── history ─────────────────────────────────────────────────────────────────

/** Listed whatever their date; any other round once its date has passed, if it was skipped or a gift was given. */
const OVER: RoundStatus[] = ["delivered", "complete"];

/** As concierge.order_is_given counts it. */
const isGiven = (o: { status: string; resolved: boolean }) =>
  !["failed", "cancelled", "refunded"].includes(o.status) || (o.status === "failed" && !o.resolved);
/** The same rule, for a query. */
const GIVEN = "status.not.in.(failed,cancelled,refunded),and(status.eq.failed,resolved.is.false)";

export type PastGiftOutcome = "delivered" | "on_its_way" | "being_bought" | "store_cancelled" | "not_bought";
export type PastGift = {
  orderId: string;
  title: string;
  /** The order's total; null while Zinc hasn't said. */
  totalCents: number | null;
  /** being_bought: held, placing, or Zinc has not confirmed it. not_bought: it failed and nobody fixed it. */
  outcome: PastGiftOutcome;
  deliveredAt: string | null;
  /** What Zinc refunded for a store cancel; null otherwise, or when Zinc didn't say. */
  refundCents: number | null;
} & Answer;
export type PastRound = {
  roundId: string;
  /** Null when the occasion was removed. */
  occasionKind: string | null;
  occasionDate: CalendarDate;
  status: RoundStatus;
  /** Given gifts and store-cancelled ones; empty when nothing was bought. */
  gifts: PastGift[];
};

function outcomeOf(o: { status: string; failure_type: string | null }): PastGiftOutcome {
  if (o.status === "delivered") return "delivered";
  if (o.status === "failed" && o.failure_type === "store_cancelled") return "store_cancelled";
  if (o.status === "failed") return "not_bought";
  return o.status === "placed" || o.status === "shipped" ? "on_its_way" : "being_bought";
}

/** The person's past rounds, newest first, with the signed-in user's client. */
export async function giftHistory(personId: string, userDb: Db, now: Date): Promise<PastRound[]> {
  if (!isId(personId)) return [];
  const { data, error } = await userDb
    .schema("concierge")
    .from("gift_rounds")
    .select(
      "id, occasion_date, status, occasions(kind), orders(id, status, failure_type, resolved, total_cents, refund_cents, delivered_at, created_at, gift_ideas(title), reactions(rating, note))",
    )
    .eq("person_id", personId)
    .order("occasion_date", { ascending: false })
    .order("id")
    .order("created_at", { referencedTable: "orders" })
    .order("id", { referencedTable: "orders" });
  if (error) fail("Loading the gift history failed", error);

  const today = dayOf(now);
  return data
    .filter((r) => OVER.includes(r.status) || (r.occasion_date < today && (r.status === "skipped" || r.orders.some(isGiven))))
    .map((r) => ({
      roundId: r.id,
      occasionKind: r.occasions?.kind ?? null,
      occasionDate: r.occasion_date,
      status: r.status,
      gifts: r.orders
        // A store cancel was bought and refunded, so it shows even once it's dealt with.
        .filter((o) => isGiven(o) || outcomeOf(o) === "store_cancelled")
        .map((o) => ({
          orderId: o.id,
          title: o.gift_ideas.title,
          totalCents: o.total_cents,
          outcome: outcomeOf(o),
          deliveredAt: o.delivered_at,
          refundCents: outcomeOf(o) === "store_cancelled" ? o.refund_cents || null : null,
          ...answerOf(o.reactions),
        })),
    }));
}

/**
 * Whether giftHistory has anything, for the person page. It reads only columns older than
 * reactions, and any failure is a no, so it can't break that page.
 */
export async function hasPastGifts(personId: string, userDb: Db, now: Date): Promise<boolean> {
  if (!isId(personId)) return false;
  try {
    const db = userDb.schema("concierge");
    const today = dayOf(now);
    const [over, given] = await Promise.all([
      db.from("gift_rounds").select("id").eq("person_id", personId).or(`status.in.(${OVER.join()}),and(status.eq.skipped,occasion_date.lt.${today})`).limit(1),
      db
        .from("orders")
        .select("id, gift_rounds!inner(id)")
        .eq("gift_rounds.person_id", personId)
        .lt("gift_rounds.occasion_date", today)
        .or(GIVEN)
        .limit(1),
    ]);
    if (over.error) fail("Looking for past rounds failed", over.error);
    if (given.error) fail("Looking for given gifts failed", given.error);
    return over.data.length > 0 || given.data.length > 0;
  } catch (error) {
    logEvent("reaction.history_check_failed", { person_id: personId, ...errorFields(error) });
    return false;
  }
}
