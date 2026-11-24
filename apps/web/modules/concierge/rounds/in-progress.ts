import { ideaBlock, type CalendarDate, type Database, type OccasionKind } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPaidFeatures } from "../paid-features";
import { isId } from "../profile/rules";
import { fail } from "../purchase/store";
import { listState, ownAddressShips, personList, sharesAddress } from "./approval";
import { beforeIdeas, roundOutcome, waitingOn } from "./outcome";
import { byNeed, progressLine, type ProgressLine } from "./progress";

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
const ORDER = "idea_id, status, failure_type, resolved, est_delivery_date, placed_at";
const IDEA = "id, status, list_item_id, handling_days_max, delivery_days_max, created_at";
// Finished rounds are kept only for a gift still on its way.
const OVER = "(complete,skipped)";
const ON_THE_WAY = ["placing", "unconfirmed", "placed", "shipped"];

/**
 * Every gift round in progress, or one person's, read with the signed-in user's client so RLS
 * applies (T26). One round of queries however many rounds there are; a further call per person is
 * made only where the answer can't be read otherwise: a linked person's shared address, and who has
 * claimed the list gifts on offer. `now` is for "today" (UTC, like the tick).
 */
export async function giftsInProgress(userDb: UserDb, now: Date, personId?: string): Promise<GiftInProgress[]> {
  if (personId !== undefined && !isId(personId)) return [];
  const db = userDb.schema("concierge");
  const today = now.toISOString().slice(0, 10);
  const mine = personId === undefined ? {} : { person_id: personId };

  const people = userDb
    .from("people")
    .select("id, name, linked_user_id, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country");
  const [openRes, overRes, peopleRes] = await Promise.all([
    db
      .from("gift_rounds")
      .select(`${ROUND}, orders(${ORDER}), gift_ideas!gift_ideas_round_id_user_id_fkey(${IDEA}), notifications(sent_at)`)
      .not("status", "in", OVER)
      .match(mine)
      .eq("notifications.kind", "no_ideas")
      .eq("notifications.channel", "email")
      .not("notifications.sent_at", "is", null)
      .is("notifications.error", null),
    db
      .from("gift_rounds")
      .select(`${ROUND}, orders!inner(${ORDER}), gift_ideas!gift_ideas_round_id_user_id_fkey(${IDEA})`)
      .filter("status", "in", OVER)
      .in("orders.status", ON_THE_WAY)
      .match(mine),
    personId === undefined ? people : people.eq("id", personId),
  ]);
  if (openRes.error) fail("Loading the gifts in progress failed", openRes.error);
  if (overRes.error) fail("Loading the gifts on their way failed", overRes.error);
  if (peopleRes.error) fail("Loading the gifts' people failed", peopleRes.error);

  // RLS hides a deleted person, and their rounds go with them.
  const personOf = new Map(peopleRes.data.map((p) => [p.id, p]));
  const rounds = [...openRes.data, ...overRes.data.map((r) => ({ ...r, notifications: [] }))].flatMap((r) => {
    const person = personOf.get(r.person_id);
    if (!person) return [];
    const ideaOf = new Map(r.gift_ideas.map((i) => [i.id, i]));
    const orders = r.orders.map((o) => ({
      status: o.status,
      failureType: o.failure_type,
      resolved: o.resolved,
      estDeliveryDate: o.est_delivery_date,
      placedAt: o.placed_at,
      handlingDaysMax: ideaOf.get(o.idea_id)?.handling_days_max ?? null,
      deliveryDaysMax: ideaOf.get(o.idea_id)?.delivery_days_max ?? null,
    }));
    const dates = { status: r.status, closedAt: r.closed_at, shipBy: r.ship_by_deadline, occasionDate: r.occasion_date, occasionYear: r.occasion_year };
    const open = roundOutcome(dates, orders, today).closed === null;
    return [{ r, person, orders, dates, open, proposed: r.gift_ideas.filter((i) => i.status === "proposed") }];
  });

  const waiting = rounds.filter((x) => x.open && beforeIdeas(x.r.status));
  const choosing = rounds.filter((x) => x.open && x.r.status === "awaiting_approval");
  const shared = new Set(
    waiting.filter((x) => x.r.status !== "generating" && x.person.linked_user_id !== null && !ownAddressShips(x.person)).map((x) => x.person.id),
  );
  const listed = new Set(choosing.filter((x) => x.proposed.some((i) => i.list_item_id !== null)).map((x) => x.person.id));
  const [paid, sharing, lists] = await Promise.all([
    waiting.length > 0 ? hasPaidFeatures(userDb, waiting[0].r.user_id) : false,
    Promise.all([...shared].map(async (id) => [id, await sharesAddress(userDb, id)] as const)).then((e) => new Map(e)),
    Promise.all([...listed].map(async (id) => [id, new Map((await personList(userDb, id))?.map((i) => [i.id, i]))] as const)).then((e) => new Map(e)),
  ]);

  const rows = rounds.flatMap(({ r, person, orders, dates, open, proposed }): GiftInProgress[] => {
    const told = r.notifications.flatMap((n) => (n.sent_at === null ? [] : [n.sent_at])).sort((a, b) => Date.parse(a) - Date.parse(b));
    const line = progressLine({ ...dates, attentionReason: r.attention_reason }, orders, {
      today,
      waiting: open
        ? waitingOn({
            status: r.status,
            paid,
            hasAddress: ownAddressShips(person) || sharing.get(person.id) === true,
            toldAt: told.at(-1) ?? null,
            ideasFoundAt: r.gift_ideas.map((i) => i.created_at),
          })
        : null,
      readyIdeas: proposed.filter(
        (i) => ideaBlock(listState(i.list_item_id, i.list_item_id === null ? undefined : lists.get(person.id)?.get(i.list_item_id))) === null,
      ).length,
    });
    if (line === null) return [];
    return [
      {
        roundId: r.id,
        personId: person.id,
        personName: person.name,
        occasionKind: (r.occasions?.kind as OccasionKind | undefined) ?? null,
        date: open ? r.ship_by_deadline : r.occasion_date,
        line,
      },
    ];
  });
  return rows.sort(byNeed);
}
