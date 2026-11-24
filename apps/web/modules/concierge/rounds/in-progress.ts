import { ideaBlock, type CalendarDate, type Database, type OccasionKind } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorFields, logEvent } from "@/lib/log";
import { hasPaidFeatures } from "../paid-features";
import { isId } from "../profile/rules";
import { fail } from "../purchase/store";
import { listState, ownAddressShips, personList, sharesAddress } from "./approval";
import type { HoldGate } from "./hold-gate";
import { beforeIdeas, heldAddress, holdState, roundOutcome, waitingOn } from "./outcome";
import { byNeed, progressLine, type ProgressFacts, type ProgressLine } from "./progress";

type UserDb = SupabaseClient<Database>;

/** One gift round in progress, for a row that opens it. */
export type GiftInProgress = {
  roundId: string;
  personId: string;
  personName: string;
  /** Null when the occasion has been removed since. */
  occasionKind: OccasionKind | null;
  /** What it's sorted by: the ship-by day while the round can still change, then the occasion. */
  date: CalendarDate;
  line: ProgressLine;
};

const ROUND = "id, user_id, person_id, occasion_date, occasion_year, ship_by_deadline, status, attention_reason, closed_at, occasions(kind)";
const ORDER = "idea_id, status, failure_type, resolved, est_delivery_date, placed_at, delivered_at, ship_to";
const IDEA = "id, status, list_item_id, handling_days_max, delivery_days_max, created_at";
const ADDRESS = "id, linked_user_id, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country";
// Finished rounds are kept only for a gift still on its way.
const OVER = "(complete,skipped)";
const ON_THE_WAY = ["placing", "unconfirmed", "placed", "shipped"];

// How the API is read, not a limit on what shows: every row is read, this many at a time.
const PAGE = 500;
const IDS_PER_READ = 100;
const AT_ONCE = 10;

type Page<T> = PromiseLike<{ data: T[] | null; count: number | null; error: { message: string; code?: string } | null }>;

/** Every row of a counted, ordered read, however few the API returns at once. */
async function every<T>(what: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, count, error } = await page(rows.length, rows.length + PAGE - 1);
    if (error) fail(`Loading ${what} failed`, error);
    rows.push(...(data ?? []));
    if (!data?.length || rows.length >= (count ?? 0)) return rows;
  }
}

/** The rows of these ids, in as many reads as a web address can hold. */
async function byIds<T>(ids: string[], read: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const chunks = Array.from({ length: Math.ceil(ids.length / IDS_PER_READ) }, (_, i) => ids.slice(i * IDS_PER_READ, (i + 1) * IDS_PER_READ));
  const rows = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await read(chunk);
      if (error) fail("Loading the gifts' people failed", error);
      return data ?? [];
    }),
  );
  return rows.flat();
}

/** One answer per person; one that fails is logged and left out, so it can't hide anyone else's. */
async function perPerson<T>(ids: Set<string>, userId: string | undefined, what: string, read: (id: string) => Promise<T>): Promise<Map<string, T>> {
  const answers = new Map<string, T>();
  const todo = [...ids];
  const worker = async () => {
    for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
      try {
        answers.set(id, await read(id));
      } catch (err) {
        logEvent("gift_progress_read_failed", { user_id: userId ?? null, person_id: id, what, ...errorFields(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return answers;
}

/**
 * Every gift round in progress, or one person's, read with the signed-in user's client so RLS
 * applies (T26). One set of queries however many rounds there are; a further call per person is
 * made only where the answer can't be read otherwise: a linked person's shared address, and who has
 * claimed the list gifts on offer. `now` is for "today" (UTC, like the tick); `leaveAfterDays` is the
 * setting gift_progress_days; `gate` reads what placing checks, only when a gift is held.
 */
export async function giftsInProgress(
  userDb: UserDb,
  o: { now: Date; leaveAfterDays: number; gate: () => Promise<HoldGate>; personId?: string },
): Promise<GiftInProgress[]> {
  if (o.personId !== undefined && !isId(o.personId)) return [];
  const db = userDb.schema("concierge");
  const today = o.now.toISOString().slice(0, 10);
  const mine = o.personId === undefined ? {} : { person_id: o.personId };

  const [openRows, overRows] = await Promise.all([
    every("the gifts in progress", (from, to) =>
      db
        .from("gift_rounds")
        .select(`${ROUND}, orders(${ORDER}), gift_ideas!gift_ideas_round_id_user_id_fkey(${IDEA}), notifications(sent_at)`, { count: "exact" })
        .not("status", "in", OVER)
        .match(mine)
        .eq("notifications.kind", "no_ideas")
        .eq("notifications.channel", "email")
        .not("notifications.sent_at", "is", null)
        .is("notifications.error", null)
        .order("id")
        .range(from, to),
    ),
    every("the gifts on their way", (from, to) =>
      db
        .from("gift_rounds")
        .select(`${ROUND}, orders!inner(${ORDER}), gift_ideas!gift_ideas_round_id_user_id_fkey(${IDEA})`, { count: "exact" })
        .filter("status", "in", OVER)
        .in("orders.status", ON_THE_WAY)
        .match(mine)
        .order("id")
        .range(from, to),
    ),
  ]);

  const rounds = [...openRows, ...overRows.map((r) => ({ ...r, notifications: [] }))].map((r) => {
    const ideaOf = new Map(r.gift_ideas.map((i) => [i.id, i]));
    const orders = r.orders.map((x) => ({
      ideaId: x.idea_id,
      shipTo: x.ship_to,
      status: x.status,
      failureType: x.failure_type,
      resolved: x.resolved,
      estDeliveryDate: x.est_delivery_date,
      placedAt: x.placed_at,
      deliveredAt: x.delivered_at,
      handlingDaysMax: ideaOf.get(x.idea_id)?.handling_days_max ?? null,
      deliveryDaysMax: ideaOf.get(x.idea_id)?.delivery_days_max ?? null,
    }));
    const dates = { status: r.status, closedAt: r.closed_at, shipBy: r.ship_by_deadline, occasionDate: r.occasion_date, occasionYear: r.occasion_year };
    const { closed, live } = roundOutcome(dates, orders, today);
    return {
      r,
      orders,
      dates,
      open: closed === null,
      held: closed === null && live.some((x) => x.status === "held"),
      proposed: r.gift_ideas.filter((i) => i.status === "proposed"),
    };
  });
  const userId = rounds[0]?.r.user_id;

  const waiting = rounds.filter((x) => x.open && beforeIdeas(x.r.status));
  // An address is read only for a round whose line depends on one.
  const addressIds = new Set(
    [...waiting.filter((x) => x.r.status !== "generating"), ...rounds.filter((x) => x.held && x.r.attention_reason === "address")].map(
      (x) => x.r.person_id,
    ),
  );
  const listed = new Set(
    rounds.filter((x) => x.open && x.r.status === "awaiting_approval" && x.proposed.some((i) => i.list_item_id !== null)).map((x) => x.r.person_id),
  );
  const [people, addresses, paid, gate, lists] = await Promise.all([
    byIds([...new Set(rounds.map((x) => x.r.person_id))], (ids) => userDb.from("people").select("id, name").in("id", ids)),
    byIds([...addressIds], (ids) => userDb.from("people").select(ADDRESS).in("id", ids)),
    waiting.length === 0 || userId === undefined
      ? false
      : hasPaidFeatures(userDb, userId).catch((err: unknown) => {
          logEvent("gift_progress_read_failed", { user_id: userId, what: "paid", ...errorFields(err) });
          return null;
        }),
    rounds.some((x) => x.held)
      ? o.gate().catch((err: unknown) => {
          logEvent("gift_progress_read_failed", { user_id: userId ?? null, what: "hold_gate", ...errorFields(err) });
          return null;
        })
      : null,
    perPerson(listed, userId, "list", async (id) => new Map((await personList(userDb, id))?.map((i) => [i.id, i]))),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const addressOf = new Map(addresses.map((p) => [p.id, { own: ownAddressShips(p), linked: p.linked_user_id !== null }]));
  const heldFor = new Set(rounds.filter((x) => x.held).map((x) => x.r.person_id));
  const askShared = new Set([...addressOf].filter(([id, a]) => a.linked && (!a.own || heldFor.has(id))).map(([id]) => id));
  const sharing = await perPerson(askShared, userId, "shared_address", (id) => sharesAddress(userDb, id));
  /** Null when it couldn't be read. */
  const shared = (id: string): boolean | null => (askShared.has(id) ? (sharing.get(id) ?? null) : false);

  const rows = rounds.flatMap((x): GiftInProgress[] => {
    const { r, orders, dates, open } = x;
    // RLS hides a deleted person, and their rounds go with them.
    const personName = nameOf.get(r.person_id);
    if (personName === undefined) return [];
    try {
      const own = addressOf.get(r.person_id)?.own ?? false;
      const isShared = shared(r.person_id);
      const list = lists.get(r.person_id);
      const line = progressLine({ ...dates, attentionReason: r.attention_reason }, orders, {
        today,
        leaveAfterDays: o.leaveAfterDays,
        waiting: waitingFor(),
        hold: x.held ? holdState(r.attention_reason, gate, isShared === null ? null : { own, shared: isShared, ...heldAddress(orders) }) : null,
        readyIdeas: ready(),
      });
      if (line === null) return [];
      return [
        {
          roundId: r.id,
          personId: r.person_id,
          personName,
          occasionKind: (r.occasions?.kind as OccasionKind | undefined) ?? null,
          date: open ? r.ship_by_deadline : r.occasion_date,
          line,
        },
      ];

      function waitingFor(): ProgressFacts["waiting"] {
        if (!open || !beforeIdeas(r.status)) return null;
        if (paid === null || (paid && !own && r.status !== "generating" && isShared === null)) return "unknown";
        const told = r.notifications.flatMap((n) => (n.sent_at === null ? [] : [n.sent_at])).sort((a, b) => Date.parse(a) - Date.parse(b));
        return waitingOn({
          status: r.status,
          paid,
          hasAddress: own || isShared === true,
          toldAt: told.at(-1) ?? null,
          ideasFoundAt: r.gift_ideas.map((i) => i.created_at),
        });
      }

      function ready(): ProgressFacts["readyIdeas"] {
        const fromList = x.proposed.filter((i) => i.list_item_id !== null);
        if (listed.has(r.person_id) && fromList.length > 0 && list === undefined) return fromList.length < x.proposed.length ? "some" : "unknown";
        return x.proposed.filter(
          (i) => ideaBlock(listState(i.list_item_id, i.list_item_id === null ? undefined : list?.get(i.list_item_id))) === null,
        ).length;
      }
    } catch (err) {
      // One round that can't be worked out (a bad row) never hides the others.
      logEvent("gift_progress_round_failed", { user_id: r.user_id, round_id: r.id, person_id: r.person_id, ...errorFields(err) });
      return [];
    }
  });
  return rows.sort(byNeed);
}
