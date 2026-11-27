// Saving, reading, replacing and removing the buyer's card, on Stripe's own card page.
// Saving a card never buys anything: the buyer taps Buy afterwards. The database side is
// SQL under the account lock (start_card_session, save_card, remove_card); this file makes
// the Stripe calls around it. Stripe gets our user id only, never a name, email or phone
// (T42). Logs carry ids we own and codes only: no customer or card id (E6).
import { z } from "zod";
import { errorFields, logEvent } from "@/lib/log";
import { normalizePhone } from "../zinc/connect";
import type { DbDeps } from "../zinc/types";
import { StripeError, stripeCall } from "./client";
import type { StripeHttp } from "./client";

export type CardDeps = DbDeps & { stripe: StripeHttp; siteUrl: string };

export type CardFrom = { roundId: string; ideaIds: string[]; failedOrderId?: string } | "settings";

/**
 * Shown on Stripe's page above its button.
 * PLACEHOLDER WORDING: the owner approves it with the card screens' mock-ups before
 * connect_enabled goes on anywhere real.
 */
export const CARD_CONSENT_TEXT =
  "GiftsAF charges this card only for gifts you approve: when you tap Buy, or on the day a gift you approved is ordered. " +
  "Each charge is the gift's price, shipping and tax plus the GiftsAF fee, and never more than the most you agreed to pay for that gift.";

/** Where Stripe sends the buyer back, finished or cancelled. Stripe fills in the session id. */
const RETURN_PATH = "/rounds/card/return?session_id={CHECKOUT_SESSION_ID}";
const SETTINGS_PATH = "/settings/paying";

// Stripe session ids: cs_test_… or cs_live_…, letters, digits and underscores.
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

async function settingInt(d: DbDeps, key: string): Promise<number> {
  const { data, error } = await d.db.schema("concierge").rpc("setting_int", { p_key: key });
  if (error) fail(`Reading setting ${key} failed`, error);
  if (typeof data !== "number") throw new Error(`Setting ${key} is missing.`);
  return data;
}

type CardAccount = { buyer_phone: string | null; stripe_customer_id: string | null; stripe_payment_method_id: string | null };

async function readAccount(d: DbDeps, userId: string): Promise<CardAccount> {
  const { data, error } = await d.db
    .schema("concierge")
    .from("accounts")
    .select("buyer_phone, stripe_customer_id, stripe_payment_method_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Reading the account failed", error);
  return data ?? { buyer_phone: null, stripe_customer_id: null, stripe_payment_method_id: null };
}

const Customer = z.object({ id: z.string().min(1) });
const Session = z.object({ id: z.string().min(1), url: z.string().url() });

// The idempotency key makes two tabs starting at once get the same customer (T42: one per buyer).
async function createCustomer(h: StripeHttp, userId: string): Promise<string> {
  const c = await stripeCall(h, "POST", "/v1/customers", Customer, {
    op: "create_customer",
    body: { metadata: { user_id: userId } },
    idempotencyKey: `customer-${userId}`,
  });
  return c.id;
}

/**
 * The buyer's Stripe customer: the account's, else a new one saved on the account at once, before
 * anything else can fail, and only while it has none (T42: one per buyer, even after Stripe's
 * 24-hour idempotency window). If another start saved one first, that one is used.
 */
async function customerFor(d: CardDeps, userId: string, saved: string | null): Promise<string> {
  if (saved) return saved;
  const created = await createCustomer(d.stripe, userId);
  const accounts = d.db.schema("concierge").from("accounts");
  const row = await accounts.upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (row.error) fail("Creating the account failed", row.error);
  const set = await accounts.update({ stripe_customer_id: created }).eq("user_id", userId).is("stripe_customer_id", null);
  if (set.error) fail("Saving the customer failed", set.error);
  const held = (await readAccount(d, userId)).stripe_customer_id;
  if (!held) throw new Error("The account has no customer after saving one.");
  // Ours is left unused at Stripe, empty; no ids are logged (E6).
  if (held !== created) logEvent("card.customer_raced", { user_id: userId });
  return held;
}

const uuidList = z.array(z.string().uuid());

/**
 * Whether the round, ideas and failed order the buyer comes back to are theirs, checked before any
 * Stripe call. start_card_session checks the same again under the account lock.
 */
async function ownsTarget(d: DbDeps, userId: string, from: Exclude<CardFrom, "settings">): Promise<boolean> {
  const ids = uuidList.safeParse([from.roundId, ...from.ideaIds, ...(from.failedOrderId ? [from.failedOrderId] : [])]);
  if (!ids.success) return false;
  const db = d.db.schema("concierge");
  const round = await db.from("gift_rounds").select("id").eq("id", from.roundId).eq("user_id", userId).maybeSingle();
  if (round.error) fail("Reading the round failed", round.error);
  if (!round.data) return false;
  if (from.failedOrderId) {
    const order = await db
      .from("orders")
      .select("id")
      .eq("id", from.failedOrderId)
      .eq("user_id", userId)
      .eq("round_id", from.roundId)
      .maybeSingle();
    if (order.error) fail("Reading the order failed", order.error);
    if (!order.data) return false;
  }
  const wanted = new Set(from.ideaIds);
  if (wanted.size === 0) return true;
  const ideas = await db.from("gift_ideas").select("id").in("id", [...wanted]).eq("user_id", userId).eq("round_id", from.roundId);
  if (ideas.error) fail("Reading the ideas failed", ideas.error);
  return (ideas.data ?? []).length === wanted.size;
}

/**
 * Leaves for Stripe's card page. "off" while connect_enabled isn't 1; "bad_phone" when the
 * account has no phone and `phone` isn't a 10-digit number (Zinc needs one for every order);
 * "not_yours" when the round, ideas or failed order aren't this buyer's.
 */
export async function startCardSession(
  d: CardDeps,
  i: { userId: string; from: CardFrom; phone?: string },
): Promise<{ url: string } | "off" | "bad_phone" | "not_yours"> {
  if ((await settingInt(d, "connect_enabled")) !== 1) return "off";
  const account = await readAccount(d, i.userId);
  let phone: string | null = null;
  if (account.buyer_phone === null) {
    phone = i.phone === undefined ? null : normalizePhone(i.phone);
    if (!phone) return "bad_phone";
  }

  const from = i.from === "settings" ? null : i.from;
  if (from && !(await ownsTarget(d, i.userId, from))) return "not_yours";

  const customer = await customerFor(d, i.userId, account.stripe_customer_id);
  const back = `${d.siteUrl}${RETURN_PATH}`;
  const session = await stripeCall(d.stripe, "POST", "/v1/checkout/sessions", Session, {
    op: "create_session",
    body: {
      mode: "setup",
      customer,
      currency: "usd",
      // Card only: no Link or other wallets, and no customer_update, so Stripe keeps as little as it can (T42).
      payment_method_types: ["card"],
      success_url: back,
      cancel_url: back,
      custom_text: { submit: { message: CARD_CONSENT_TEXT } },
    },
  });

  const { data, error } = await d.db.schema("concierge").rpc("start_card_session", {
    p_user_id: i.userId,
    p_session_id: session.id,
    p_customer: customer,
    p_round_id: from?.roundId ?? null,
    p_idea_ids: from ? from.ideaIds : null,
    p_failed_order_id: from?.failedOrderId ?? null,
    // The generated types mark every argument required; the SQL takes nulls for a Settings visit.
  } as never);
  if (error) fail("Starting the card visit failed", error);
  if (data === "not_yours") return "not_yours";
  // The account's customer changed under us: only a second customer for one buyer does that.
  if (data !== "ok") throw new Error(`start_card_session returned ${String(data)}.`);

  if (phone) {
    const saved = await d.db.schema("concierge").from("accounts").update({ buyer_phone: phone }).eq("user_id", i.userId).is("buyer_phone", null);
    if (saved.error) fail("Saving the phone failed", saved.error);
  }
  logEvent("card.session_started", { user_id: i.userId, round_id: from?.roundId ?? null });
  return { url: session.url };
}

const SessionBack = z.object({
  id: z.string(),
  status: z.string(),
  mode: z.string(),
  livemode: z.boolean(),
  customer: z.string().nullable(),
  setup_intent: z
    .object({ id: z.string(), status: z.string(), usage: z.string(), payment_method: z.string().nullable() })
    .nullable(),
});

type VisitRow = {
  user_id: string;
  stripe_customer_id: string;
  round_id: string | null;
  idea_ids: string[] | null;
  failed_order_id: string | null;
  used_at: string | null;
};

/** Where the buyer goes back to, from what we stored when they left; never from the request. */
function backTo(row: VisitRow): string {
  if (!row.round_id) return SETTINGS_PATH;
  if (row.failed_order_id) return `/rounds/${row.round_id}/fix/${row.failed_order_id}`;
  if (row.idea_ids?.length) return `/rounds/${row.round_id}/buy?ideas=${row.idea_ids.join(",")}`;
  return `/rounds/${row.round_id}`;
}

/**
 * Back from Stripe's page. Saves the card only when Stripe says the visit is complete, in setup
 * mode and our key's mode, for the customer we stored, with a card set up for later charges, and
 * save_card agrees (this buyer's visit, used once, not older than card_session_minutes).
 * A visit Stripe hasn't completed (the buyer cancelled) saves nothing and goes back too.
 */
export async function finishCardSession(
  d: CardDeps,
  i: { userId: string; sessionId: string },
): Promise<{ status: "saved" | "cancelled"; backTo: string } | "used" | "not_yours"> {
  const refuse = <T extends "used" | "not_yours">(reason: T, why: string): T => {
    logEvent("card.return_refused", { user_id: i.userId, reason, why });
    return reason;
  };
  if (!SESSION_ID.test(i.sessionId)) return refuse("not_yours", "bad_id");
  const { data: row, error } = await d.db
    .schema("concierge")
    .from("card_sessions")
    .select("user_id, stripe_customer_id, round_id, idea_ids, failed_order_id, used_at")
    .eq("stripe_session_id", i.sessionId)
    .maybeSingle();
  if (error) fail("Reading the card visit failed", error);
  if (!row || row.user_id !== i.userId) return refuse("not_yours", "visit");
  if (row.used_at) return refuse("used", "visit");

  let session: z.infer<typeof SessionBack>;
  try {
    session = await stripeCall(d.stripe, "GET", `/v1/checkout/sessions/${encodeURIComponent(i.sessionId)}`, SessionBack, {
      op: "read_session",
      query: { "expand[]": "setup_intent" },
    });
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return refuse("not_yours", "stripe_missing");
    throw e;
  }
  if (session.mode !== "setup" || session.livemode !== (d.stripe.mode === "live")) return refuse("not_yours", "mode");
  if (session.customer !== row.stripe_customer_id) return refuse("not_yours", "customer");
  const si = session.setup_intent;
  if (session.status !== "complete" || !si || si.status !== "succeeded" || !si.payment_method) {
    return { status: "cancelled", backTo: backTo(row) };
  }
  // Zinc charges the card later, without the buyer there.
  if (si.usage !== "off_session") return refuse("not_yours", "usage");

  const saved = await d.db.schema("concierge").rpc("save_card", {
    p_user_id: i.userId,
    p_session_id: i.sessionId,
    p_customer: session.customer,
    p_payment_method: si.payment_method,
  });
  if (saved.error) fail("Saving the card failed", saved.error);
  if (saved.data === "used" || saved.data === "not_yours") return refuse(saved.data, "save_card");
  if (saved.data !== "ok") throw new Error(`save_card returned ${String(saved.data)}.`);

  logEvent("card.saved", { user_id: i.userId, round_id: row.round_id });
  await detachOthers(d, i.userId, session.customer, si.payment_method);
  return { status: "saved", backTo: backTo(row) };
}

const CardList = z.object({ data: z.array(z.object({ id: z.string() })), has_more: z.boolean() });

/**
 * Detaches the customer's cards except `keep` and any a placing or unconfirmed order was sent
 * on, so Zinc can still capture its hold; those go at the next Remove or Replace. False when
 * any detach (or the listing) failed: logged as card.detach_failed, not an alert.
 */
async function detachOthers(d: CardDeps, userId: string, customer: string, keep: string | null): Promise<boolean> {
  const { data: inFlight, error } = await d.db
    .schema("concierge")
    .from("orders")
    .select("payment_method_id")
    .eq("user_id", userId)
    .in("status", ["placing", "unconfirmed"])
    .not("payment_method_id", "is", null);
  if (error) fail("Reading orders in flight failed", error);
  const kept = new Set<string>([...(keep ? [keep] : []), ...(inFlight ?? []).map((o) => o.payment_method_id as string)]);

  let cards: string[];
  try {
    const list = await stripeCall(d.stripe, "GET", `/v1/customers/${encodeURIComponent(customer)}/payment_methods`, CardList, {
      op: "list_cards",
      query: { type: "card", limit: "100" },
    });
    cards = list.data.map((c) => c.id);
  } catch (e) {
    logEvent("card.detach_failed", { user_id: userId, step: "list", ...errorFields(e) });
    return false;
  }

  let ok = true;
  for (const pm of cards.filter((c) => !kept.has(c))) {
    try {
      await stripeCall(d.stripe, "POST", `/v1/payment_methods/${encodeURIComponent(pm)}/detach`, z.object({ id: z.string() }), {
        op: "detach_card",
      });
    } catch (e) {
      ok = false;
      logEvent("card.detach_failed", { user_id: userId, step: "detach", ...errorFields(e) });
    }
  }
  return ok;
}

/**
 * Settings > Remove. "placing" while an order is being sent (nothing changes, no Stripe call).
 * Otherwise the database forgets the card first, then the cards are detached at Stripe;
 * "detach_failed" when one couldn't be (the card is already removed on our side).
 */
export async function removeCard(d: CardDeps, userId: string): Promise<"ok" | "placing" | "detach_failed"> {
  const { data, error } = await d.db.schema("concierge").rpc("remove_card", { p_user_id: userId });
  if (error) fail("Removing the card failed", error);
  if (data === "placing") return "placing";
  if (data !== "ok") throw new Error(`remove_card returned ${String(data)}.`);
  logEvent("card.removed", { user_id: userId });
  const { stripe_customer_id: customer } = await readAccount(d, userId);
  if (!customer) return "ok";
  return (await detachOthers(d, userId, customer, null)) ? "ok" : "detach_failed";
}

const PaymentMethod = z.object({ card: z.object({ brand: z.string(), last4: z.string() }).nullish() });

/** The saved card's brand and last four, read live from Stripe for Settings; nothing card-related is stored. */
export async function savedCard(d: CardDeps, userId: string): Promise<{ brand: string; last4: string } | null> {
  const { stripe_payment_method_id: pm } = await readAccount(d, userId);
  if (!pm) return null;
  const out = await stripeCall(d.stripe, "GET", `/v1/payment_methods/${encodeURIComponent(pm)}`, PaymentMethod, { op: "read_card" });
  return out.card ? { brand: out.card.brand, last4: out.card.last4 } : null;
}
