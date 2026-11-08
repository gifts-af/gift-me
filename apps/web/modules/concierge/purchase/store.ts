// What buying needs from our database (ALL-32 Task 6, ALL-30). Thin reads on the
// service-role client in `deps.db`; every write that changes an order or a round
// goes through the money-path SQL functions (migration 20261109100000), which
// lock the round row and leave its status to reconcile_round.
import type { AddressDraft, CalendarDate, ScheduleSettings } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import type { ZincDeps } from "../zinc/types";

export type PurchaseDeps = ZincDeps & {
  /** zinc_order_fee_cents and order_price_margin_pct, read by the caller (T23). */
  settings: { feeCents: number; marginPct: number };
  /** The round engine's advanceRound, bound by the caller (justPlaced): sends a new hold's or failure's notice. */
  advanceRound: (roundId: string) => Promise<unknown>;
  /**
   * The engine's tellOrdered, bound by the caller: the "ordered" email once the sweep finds an order
   * placed, and the "we couldn't buy it" email for one that failed after its round closed.
   */
  orderPlaced?: (roundId: string) => Promise<unknown>;
  /** For the quick retries' backoff; real timers when left out. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds, for the placing time budget; Date.now when left out. */
  clock?: () => number;
};

export function concierge(deps: ZincDeps) {
  return deps.db.schema("concierge");
}

export function fail(what: string, error: { message: string; code?: string }): never {
  throw Object.assign(new Error(`${what}: ${error.message}`), { code: error.code });
}

export async function setting(deps: ZincDeps, key: string): Promise<number> {
  const { data, error } = await concierge(deps).rpc("setting_int", { p_key: key });
  if (error) fail(`Reading setting ${key} failed`, error);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

const SCHEDULE_KEYS: Record<keyof ScheduleSettings, string> = {
  planningDeliveryDays: "planning_delivery_days",
  safetyBufferDays: "safety_buffer_days",
  roundLeadDays: "round_lead_days",
  reminder1AfterHeadsUpDays: "reminder_1_after_heads_up_days",
  reminder2BeforeDeadlineDays: "reminder_2_before_deadline_days",
  finalNoticeBeforeDeadlineDays: "final_notice_before_deadline_days",
  fastestDaysToArrive: "fastest_days_to_arrive",
  holdReminderDays: "hold_reminder_days",
  holdFinalDays: "hold_final_days",
};

export async function scheduleSettings(deps: ZincDeps): Promise<ScheduleSettings> {
  const keys = Object.keys(SCHEDULE_KEYS) as (keyof ScheduleSettings)[];
  const values = await Promise.all(keys.map((k) => setting(deps, SCHEDULE_KEYS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as ScheduleSettings;
}

export type RoundRow = {
  id: string;
  user_id: string;
  person_id: string;
  occasion_id: string;
  occasion_date: CalendarDate;
  ship_by_deadline: CalendarDate;
  budget_cents: number | null;
  status: string;
  attention_reason: string | null;
  locked_until: string | null;
  closed_at: string | null;
};

export async function readRound(deps: ZincDeps, roundId: string): Promise<RoundRow | null> {
  const { data, error } = await concierge(deps)
    .from("gift_rounds")
    .select("id, user_id, person_id, occasion_id, occasion_date, ship_by_deadline, budget_cents, status, attention_reason, locked_until, closed_at")
    .eq("id", roundId)
    .maybeSingle();
  if (error) fail("Loading the round failed", error);
  return data as RoundRow | null;
}

/** A failure the buyer hasn't been told about (untold_failures, ALL-116), whatever the round's reason. */
export async function hasUntoldFailure(deps: ZincDeps, roundId: string): Promise<boolean> {
  const { data, error } = await concierge(deps).rpc("untold_failures", { p_round_id: roundId });
  if (error) fail("Reading the round's failures failed", error);
  return (data ?? []).length > 0;
}

/** The person is live and the occasion still on. */
export async function roundStillWanted(deps: ZincDeps, r: RoundRow): Promise<boolean> {
  const [person, occasion] = await Promise.all([
    deps.db.from("people").select("id").eq("id", r.person_id).is("deleted_at", null).maybeSingle(),
    concierge(deps).from("occasions").select("id").eq("id", r.occasion_id).eq("enabled", true).is("deleted_at", null).maybeSingle(),
  ]);
  if (person.error) fail("Loading the round's person failed", person.error);
  if (occasion.error) fail("Loading the round's occasion failed", occasion.error);
  return person.data !== null && occasion.data !== null;
}

export type OrderRow = {
  id: string;
  idea_id: string;
  status: string;
  hold_reason: string | null;
  max_price_cents: number;
  fee_cents: number;
  total_cents: number | null;
  idempotency_key: string;
  gift_message: string | null;
  ship_to: string;
  /** Which address it was approved against (ALL-112); null on older orders, which count as own. */
  address_source: AddressSource | null;
  created_at: string;
};

/** The round's orders that still count (not cancelled, not a dealt-with failure), oldest first. */
export async function liveOrders(deps: ZincDeps, roundId: string): Promise<OrderRow[]> {
  const { data, error } = await concierge(deps)
    .from("orders")
    .select("id, idea_id, status, hold_reason, max_price_cents, fee_cents, total_cents, idempotency_key, gift_message, ship_to, address_source, created_at, resolved")
    .eq("round_id", roundId)
    .neq("status", "cancelled")
    .order("created_at")
    .order("id");
  if (error) fail("Loading the round's orders failed", error);
  return (data ?? []).filter((o) => !(o.status === "failed" && o.resolved)) as OrderRow[];
}

export type IdeaRow = {
  id: string;
  product_url: string | null;
  est_total_cents: number;
  handling_days_max: number | null;
  delivery_days_max: number | null;
  over_budget: boolean;
  /** The idea's place in the round's list; picks get their caps and are sent in this order. */
  rank: number;
};

export async function readIdeas(deps: ZincDeps, ids: string[]): Promise<Map<string, IdeaRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await concierge(deps)
    .from("gift_ideas")
    .select("id, product_url, est_total_cents, handling_days_max, delivery_days_max, over_budget, rank")
    .in("id", ids);
  if (error) fail("Loading the ideas failed", error);
  return new Map((data ?? []).map((i) => [i.id, i as IdeaRow]));
}

export type Account = {
  zinc_connected_at: string | null;
  buyer_phone: string | null;
  auto_topup_on: boolean | null;
  over_budget_pct: number;
};

export async function readAccount(deps: ZincDeps, userId: string): Promise<Account | null> {
  const { data, error } = await concierge(deps)
    .from("accounts")
    .select("zinc_connected_at, buyer_phone, auto_topup_on, over_budget_pct")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Reading the account failed", error);
  return data as Account | null;
}

/** The user's Zinc key and the environment it was saved for, or null when not connected. */
export async function readKey(deps: ZincDeps, userId: string): Promise<{ apiKey: string; env: string | null } | null> {
  const { data, error } = await concierge(deps).rpc("zinc_secrets", { p_user_id: userId });
  if (error) fail("Reading the Zinc key failed", error);
  const row = data?.[0];
  return row?.api_key ? { apiKey: row.api_key, env: row.zinc_env } : null;
}

/** The order_addresses columns, as approve_round and begin_placing take them. */
export type AddressSnapshot = {
  recipient_first_name: string;
  recipient_last_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string | null;
};

type AddressColumns = { [K in keyof AddressSnapshot]?: string | null };

/** Whose address an order ships to: a list owner's shared one, or the buyer's own entry (T61). */
export type AddressSource = "shared" | "own";

function toDraft(a: AddressColumns): AddressDraft & { country?: string | null } {
  return {
    firstName: a.recipient_first_name,
    lastName: a.recipient_last_name,
    line1: a.address_line1,
    line2: a.address_line2,
    city: a.city,
    state: a.state,
    zip: a.zip,
    country: a.country,
  };
}

function toSnapshot(a: AddressColumns): AddressSnapshot {
  return {
    recipient_first_name: a.recipient_first_name ?? "",
    recipient_last_name: a.recipient_last_name ?? "",
    address_line1: a.address_line1 ?? "",
    address_line2: a.address_line2 ?? null,
    city: a.city ?? "",
    state: a.state ?? "",
    zip: a.zip ?? "",
    country: a.country ?? "",
    phone: a.phone ?? null,
  };
}

/**
 * The recipient's current address, read now: the address the linked list owner shares
 * (public.shared_address_for_person) when there is one, else the one the buyer saved on
 * the person. Null when the person is gone. `draft` is for isShippableAddress.
 */
export async function recipientAddress(
  deps: ZincDeps,
  personId: string,
): Promise<{ snapshot: AddressSnapshot; draft: AddressDraft & { country?: string | null }; source: AddressSource } | null> {
  const shared = await deps.db.rpc("shared_address_for_person", { p_person_id: personId });
  if (shared.error) fail("Reading the shared address failed", shared.error);
  if (shared.data && typeof shared.data === "object") {
    const a = shared.data as AddressColumns;
    return { snapshot: toSnapshot(a), draft: toDraft(a), source: "shared" };
  }
  const { data, error } = await deps.db
    .from("people")
    .select("recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country, phone")
    .eq("id", personId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("Reading the person's address failed", error);
  if (!data) return null;
  return { snapshot: toSnapshot(data), draft: toDraft(data), source: "own" };
}

export async function savedSnapshots(deps: ZincDeps, orderIds: string[]): Promise<Map<string, AddressSnapshot>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await concierge(deps)
    .from("order_addresses")
    .select("order_id, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country, phone")
    .in("order_id", orderIds);
  if (error) fail("Reading the order addresses failed", error);
  return new Map((data ?? []).map(({ order_id, ...a }) => [order_id, toSnapshot(a)]));
}

/** Runs a money-path SQL function that returns the round's status. */
export async function roundRpc(
  deps: ZincDeps,
  fn: "hold_orders" | "gate_held_orders" | "fail_order" | "record_outcomes" | "mark_unconfirmed",
  args: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await (concierge(deps).rpc as (f: string, a: unknown) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>)(fn, args);
  if (error) fail(`${fn} failed`, error);
  return (data as string | null) ?? null;
}

export async function releaseRound(deps: ZincDeps, roundId: string, lock: string): Promise<void> {
  const { error } = await concierge(deps).rpc("release_round", { p_round_id: roundId, p_lock: lock });
  if (error) fail("Releasing the round failed", error);
}

/**
 * Runs `run` with the lease held, then gives it back. A release that fails is logged and
 * never masks run's own error or result: the lease runs out by itself (round_lock_minutes).
 */
export async function withLease<T>(deps: ZincDeps, roundId: string, lock: string, run: () => Promise<T>): Promise<T> {
  const release = async () => {
    try {
      await releaseRound(deps, roundId, lock);
    } catch (e) {
      logEvent("round.release_failed", { round_id: roundId, ...errorFields(e) });
    }
  };
  try {
    return await run();
  } finally {
    await release();
  }
}

/** Takes the round's lease now (ignores next_action_at); the lock value, or null when busy or not claimable. */
export async function claimRoundNow(deps: ZincDeps, roundId: string): Promise<string | null> {
  const { data, error } = await concierge(deps).rpc("claim_round_now", { p_round_id: roundId, p_now: deps.now.toISOString() });
  if (error) fail("Claiming the round failed", error);
  // A NULL row comes back through PostgREST as a row of nulls.
  const row = data as { id: string | null; locked_until: string | null } | null;
  return row?.id && row.locked_until ? row.locked_until : null;
}
