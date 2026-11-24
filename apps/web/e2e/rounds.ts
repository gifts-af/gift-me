import { randomUUID } from "node:crypto";
import { localSupabase } from "./local-supabase";
import { session, type Credentials } from "./sign-in";

// Rounds, ideas and orders for the approval journeys, layout checks and gallery (ALL-29). The app
// can't create these itself (the engine and Zinc do), so they're written with the service role
// (T62). Lists, links and budgets go through the app instead (seed.ts, and the RPCs below).

const supabase = localSupabase();
const service = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};

type Rest = { method?: string; profile?: "concierge" | "lists" | "public"; body?: unknown; token?: string; upsert?: boolean };

/** One REST call, as the service role or (with `token`) as a signed-in user; the parsed reply. */
export async function rest<T = unknown>(path: string, o: Rest = {}): Promise<T> {
  const profile = o.profile ?? "concierge";
  const res = await fetch(`${supabase.url}/rest/v1/${path}`, {
    method: o.method ?? "GET",
    headers: {
      ...service,
      ...(o.token ? { apikey: supabase.publishableKey, Authorization: `Bearer ${o.token}` } : {}),
      "Accept-Profile": profile,
      "Content-Profile": profile,
      Prefer: o.upsert ? "return=representation,resolution=merge-duplicates" : "return=representation",
    },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${o.method ?? "GET"} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** A REST RPC as the signed-in user, the way the app calls it. */
export async function rpcAs<T = unknown>(user: Credentials, profile: "concierge" | "lists", name: string, args: object): Promise<T> {
  const { access_token } = await session(user);
  return rest<T>(`rpc/${name}`, { method: "POST", profile, body: args, token: access_token });
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const dayFromNow = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);

export type Buyer = { creds: Credentials; id: string; zincKey: string };

/**
 * Makes `creds` a buyer who can buy: paid features (test accounts during the alpha), a phone for
 * Zinc, a 20% over-budget allowance, and a connected Zinc account whose key the fake Zinc takes.
 */
export async function readyBuyer(creds: Credentials): Promise<Buyer> {
  const id = (await session(creds)).user.id;
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    upsert: true,
    body: { user_id: id, paid_features: true, buyer_phone: "5555550100", over_budget_pct: 20 },
  });
  const zincKey = `zn_live_e2e_${id}`;
  // playwright.config.ts runs the app with ZINC_ENV=live, so the key is a live one.
  await rest("rpc/zinc_store_secrets", {
    method: "POST",
    body: { p_user_id: id, p_api_key: zincKey, p_webhook_secret: `zn_whsec_${randomUUID()}`, p_webhook_id: randomUUID(), p_zinc_env: "live" },
  });
  return { creds, id, zincKey };
}

/**
 * A person with a complete address (so a gift can ship to them) and a birthday occasion, for
 * `buyerId`. Returns the person and occasion ids.
 */
export async function personFor(buyerId: string, name: string, o: { fact?: string } = {}): Promise<{ personId: string; occasionId: string }> {
  const [person] = await rest<{ id: string }[]>("people", {
    method: "POST",
    profile: "public",
    body: {
      user_id: buyerId,
      name,
      relationship: "friend",
      recipient_first_name: name,
      recipient_last_name: "Rivera",
      address_line1: "12 Oak St",
      city: "Dayton",
      state: "OH",
      zip: "45402",
      country: "US",
    },
  });
  const occasionDate = new Date(Date.now() + 50 * DAY_MS);
  const [occasion] = await rest<{ id: string }[]>("occasions", {
    method: "POST",
    body: { user_id: buyerId, person_id: person.id, kind: "birthday", month: occasionDate.getUTCMonth() + 1, day: occasionDate.getUTCDate() },
  });
  if (o.fact) {
    await rest("profile_facts", { method: "POST", body: { user_id: buyerId, person_id: person.id, category: "wants", value: o.fact, source: "note" } });
  }
  return { personId: person.id, occasionId: occasion.id };
}

export type IdeaSeed = {
  title: string;
  totalCents: number;
  /** Amazon's id, so the price can be checked again; a product link is made from it. */
  productId?: string;
  url?: string;
  reason?: string;
  source?: "generated" | "list";
  listItemId?: string;
  imageUrl?: string | null;
};

export type RoundSeed = {
  status?: "awaiting_approval" | "generating";
  budgetCents?: number | null;
  /** Days from today to the ship-by deadline; the birthday is 10 days later. */
  shipByIn?: number;
  ideas?: IdeaSeed[];
};

/**
 * A round as the engine leaves it: awaiting approval with its ideas (or generating, due now, for
 * the tick to find ideas). An awaiting round's next look is the day before its deadline, so no
 * other spec's tick reaches it during a run.
 */
export async function seedRound(
  buyerId: string,
  p: { personId: string; occasionId: string },
  o: RoundSeed = {},
): Promise<{ roundId: string; ideaIds: string[] }> {
  const shipByIn = o.shipByIn ?? 40;
  const occasionDate = dayFromNow(shipByIn + 10);
  const generating = o.status === "generating";
  const [round] = await rest<{ id: string }[]>("gift_rounds", {
    method: "POST",
    body: {
      user_id: buyerId,
      person_id: p.personId,
      occasion_id: p.occasionId,
      occasion_year: Number(occasionDate.slice(0, 4)),
      occasion_date: occasionDate,
      ship_by_deadline: dayFromNow(shipByIn),
      budget_cents: o.budgetCents === undefined ? null : o.budgetCents,
      status: o.status ?? "awaiting_approval",
      next_action_at: generating ? new Date().toISOString() : `${dayFromNow(shipByIn - 1)}T12:00:00Z`,
      heads_up_on: generating ? null : dayFromNow(0),
    },
  });
  const ideas = o.ideas ?? [];
  if (ideas.length === 0) return { roundId: round.id, ideaIds: [] };
  const rows = await rest<{ id: string; rank: number }[]>("gift_ideas", {
    method: "POST",
    body: ideas.map((i, n) => ({
      user_id: buyerId,
      round_id: round.id,
      person_id: p.personId,
      title: i.title,
      retailer: "amazon",
      retailer_product_id: i.productId ?? null,
      offer_id: i.productId ? `e2e-offer` : null,
      product_url: i.url ?? `https://www.amazon.com/dp/${i.productId ?? `B0E2E${randomUUID().slice(0, 5).toUpperCase()}`}`,
      price_cents: i.totalCents,
      est_total_cents: i.totalCents,
      handling_days_max: 1,
      delivery_days_min: 2,
      delivery_days_max: 4,
      arrive_by: dayFromNow(8),
      reason: i.reason ?? "A good fit for what they asked for.",
      over_budget: o.budgetCents != null && i.totalCents > o.budgetCents,
      rank: n + 1,
      source: i.source ?? "generated",
      list_item_id: i.listItemId ?? null,
      image_url: i.imageUrl ?? null,
    })),
  });
  return { roundId: round.id, ideaIds: rows.sort((a, b) => a.rank - b.rank).map((r) => r.id) };
}

/**
 * One idea's order that failed at the store (`failureType`), as Zinc's answer leaves it: the idea
 * selected and the round needing attention. For layout checks and the gallery; the journeys get
 * theirs from the fake Zinc.
 */
export async function seedFailedOrder(buyerId: string, roundId: string, ideaId: string, failureType: string): Promise<string> {
  await rest(`gift_ideas?id=eq.${ideaId}`, { method: "PATCH", body: { status: "selected" } });
  const [order] = await rest<{ id: string }[]>("orders", {
    method: "POST",
    body: {
      user_id: buyerId,
      round_id: roundId,
      idea_id: ideaId,
      funding_mode: "zinc_wallet",
      max_price_cents: 2500,
      fee_cents: 100,
      ship_to: "recipient",
      ship_city: "Dayton",
      ship_state: "OH",
      status: "failed",
      failure_type: failureType,
    },
  });
  await rest(`gift_rounds?id=eq.${roundId}`, { method: "PATCH", body: { status: "needs_attention", attention_reason: failureType } });
  return order.id;
}

/** A list for `owner`, saved as My list does, with these gifts; its share token and item ids, in order. */
export async function listFor(
  owner: Credentials,
  items: { name: string; url: string | null; priceCents: number | null; asin?: string | null }[],
): Promise<{ token: string; itemIds: string[] }> {
  await rpcAs(owner, "lists", "save_list_checked", {
    p_list_id: null,
    p_title: null,
    p_items: items.map((i) => ({
      id: null,
      name: i.name,
      price_cents: i.priceCents,
      image_url: null,
      product_url: i.url,
      asin: i.asin ?? null,
      source: "manual",
      added_at: null,
    })),
    p_expected: null,
  });
  const ownerId = (await session(owner)).user.id;
  const [list] = await rest<{ id: string; share_token: string }[]>(`lists?select=id,share_token&owner_id=eq.${ownerId}`, { profile: "lists" });
  const rows = await rest<{ id: string; name: string; position: number }[]>(`list_items?select=id,name,position&list_id=eq.${list.id}&order=position`, {
    profile: "lists",
  });
  return { token: list.share_token, itemIds: items.map((i) => rows.find((r) => r.name === i.name)!.id) };
}

/** The buyer links their person to a list, as pasting its link on Their list does. */
export async function linkList(buyer: Credentials, personId: string, token: string): Promise<void> {
  await rpcAs(buyer, "lists", "link_person", { p_token: token, p_person_id: personId });
}

/** The round's orders, oldest first. */
export async function ordersOf(roundId: string): Promise<{ id: string; idea_id: string; status: string; failure_type: string | null; resolved: boolean }[]> {
  return rest(`orders?select=id,idea_id,status,failure_type,resolved&round_id=eq.${roundId}&order=created_at`);
}

/**
 * One idea's bought order in any state Zinc's events leave it in: `fields` are the order's
 * own columns (status, placed_at, est_delivery_date, packages, delivered_at, failure_type, …). The
 * idea is marked selected; the round's status is the caller's to set.
 */
export async function seedOrder(buyerId: string, roundId: string, ideaId: string, fields: Record<string, unknown>): Promise<string> {
  await rest(`gift_ideas?id=eq.${ideaId}`, { method: "PATCH", body: { status: "selected" } });
  const [order] = await rest<{ id: string }[]>("orders", {
    method: "POST",
    body: {
      user_id: buyerId,
      round_id: roundId,
      idea_id: ideaId,
      funding_mode: "zinc_wallet",
      max_price_cents: 4600,
      fee_cents: 100,
      ship_to: "recipient",
      ship_city: "Dayton",
      ship_state: "OH",
      provider_order_id: randomUUID(),
      total_cents: 4218,
      ...fields,
    },
  });
  return order.id;
}
