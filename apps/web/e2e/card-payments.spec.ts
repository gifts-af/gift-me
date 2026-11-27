import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { holdConnectOn, whileConnectOff } from "./connect-switch";
import { FAKE_STRIPE_URL } from "./fake-stripe";
import { FAKE_PRODUCTS, FAKE_ZINC_URL } from "./fake-zinc";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { ordersOf, personFor, readyBuyer, rest, seedFailedOrder, seedRound } from "./rounds";
import { session, signIn, type Credentials } from "./sign-in";

// ALL-98: paying by card, against the local Supabase, the fake Stripe (fake-stripe.ts: its API and
// its card page) and the fake Zinc, which takes card orders on the app's own key
// (playwright.config.ts). Who pays by card, and the switch, are set with the service role: only the
// launch migration and the owner set them for real (plan Task 10).
//
// One journey per main path (T67): add a card and buy; cancel on Stripe's page; a declined card,
// a new card and Buy again; a held gift whose card was removed, then a card added for another
// gift; paying by card switched off; and a wallet buyer's page unchanged. What
// each screen shows in every state is in the component tests (confirm-screen-card, fix-screen-card,
// card-paying), the money rules in the local-db tests and pgTAP. The pictures at the end are
// tagged @layout (T62).
test.skip(!!process.env.E2E_BASE_URL, "needs the fake Stripe, the fake Zinc and local Supabase");

const CONNECT_KEY = "zn_live_E2E_CONNECT_KEY";
const SHOTS = path.resolve(__dirname, "screenshots", "ALL-98");

type CardBuyer = { creds: Credentials; id: string };

/** A fresh account that pays by card: paid features, a 20% allowance, and a phone unless `phone` is null. */
async function cardBuyer(o: { phone?: string | null } = {}): Promise<CardBuyer> {
  const creds = await createFreshUser();
  const id = (await session(creds)).user.id;
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    upsert: true,
    body: {
      user_id: id,
      paid_features: true,
      over_budget_pct: 20,
      funding_mode: "connect",
      buyer_phone: o.phone === undefined ? "5555550100" : o.phone,
    },
  });
  return { creds, id };
}

/** A round for Jimmy (or `name`) with one idea, priced as the idea run saves it: goods alone, and the wallet total. */
async function roundWith(buyerId: string, product: { productId: string; priceCents: number; title: string }, name = "Jimmy") {
  const p = await personFor(buyerId, name);
  const r = await seedRound(buyerId, p, {
    budgetCents: 4000,
    ideas: [{ title: product.title, totalCents: product.priceCents + 100, productId: product.productId }],
  });
  await rest(`gift_ideas?id=eq.${r.ideaIds[0]}`, { method: "PATCH", body: { goods_cents: product.priceCents } });
  return { ...r, ideaId: r.ideaIds[0] };
}

/** How many orders for this round were sent to the fake Zinc on the app's card key. */
async function cardOrdersAtZinc(roundId: string): Promise<number> {
  const ids = (await ordersOf(roundId)).map((o) => o.id).join(",");
  const res = await fetch(`${FAKE_ZINC_URL}/__posts?key=${CONNECT_KEY}&order_ids=${ids}`);
  return ((await res.json()) as { count: number }).count;
}

const savedCardOf = async (id: string) =>
  (await rest<{ stripe_payment_method_id: string | null }[]>(`accounts?select=stripe_payment_method_id&user_id=eq.${id}`))[0].stripe_payment_method_id;

const orderOf = async (roundId: string) => (await ordersOf(roundId))[0];

// The daily tick, as approval.spec.ts runs it: the engine switched on (round-engine.spec.ts turns it
// off around its own tests, in parallel), asked again if it found it off. Only rounds due now move.
const CRON_SECRET = "e2e-cron-secret";
async function tick(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await rest("app_settings?key=eq.round_engine_enabled", { method: "PATCH", body: { value: 1 } });
    const res = await page.request.get("/api/rounds/tick", { headers: { Authorization: `Bearer ${CRON_SECRET}` }, timeout: 120_000 });
    expect(res.status(), await res.text()).toBe(200);
    if (((await res.json()) as { enabled: boolean }).enabled) return;
  }
  throw new Error("The round engine kept being switched off under the tick");
}

const setting = async (key: string) =>
  (await rest<{ value: number }[]>(`app_settings?select=value&key=eq.${key}`))[0].value;

/**
 * Approves one idea through the real approve_round, as a Buy now tap does before placing: the
 * round's lease taken, today's fee inputs, the person's address. It leaves the pick held for a
 * retry, and the round not due, so no other spec's tick places it before this test asks.
 */
async function approveHeld(buyerId: string, roundId: string, ideaId: string) {
  const lock = new Date(Date.now() + 10 * 60_000).toISOString();
  await rest(`gift_rounds?id=eq.${roundId}`, { method: "PATCH", body: { locked_until: lock } });
  const [ai, running, zincFee, bps, fixed] = await Promise.all(
    ["fee_part_ai_cents", "fee_part_running_cents", "zinc_fee_cents", "card_fee_bps", "card_fee_fixed_cents"].map(setting),
  );
  await rest("rpc/approve_round", {
    method: "POST",
    body: {
      p_round_id: roundId,
      p_user_id: buyerId,
      p_lock: lock,
      p_orders: [
        {
          idea_id: ideaId,
          max_price_cents: 2500,
          margin_cents: ai + running,
          zinc_fee_cents: zincFee,
          card_fee_bps: bps,
          card_fee_fixed_cents: fixed,
          ship_to: "recipient",
          address_source: "own",
          address: { recipient_first_name: "Jimmy", recipient_last_name: "Rivera", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
        },
      ],
    },
  });
  await rest(`gift_rounds?id=eq.${roundId}`, { method: "PATCH", body: { locked_until: null, next_action_at: new Date(Date.now() + 7 * 86_400_000).toISOString() } });
}

async function setConnect(on: boolean) {
  await rest("app_settings?key=eq.connect_enabled", { method: "PATCH", body: { value: on ? 1 : 0 } });
}

/** On Stripe's (fake) page: save the test card, or go back. */
async function onStripe(page: Page, choice: "Save card" | "Back") {
  await page.waitForURL(`${FAKE_STRIPE_URL}/pay/**`);
  await page.getByRole("link", { name: choice }).click();
}

// connect_enabled is one switch for the whole app; only this file's tests have card accounts. Each
// test needs it on, except the one that turns it off, which waits for the others (connect-switch.ts).
const SWITCHES_OFF = "AC-12:";
let release: (() => void) | null = null;
test.beforeEach(async ({}, info) => {
  // Buying goes through Zinc and Stripe's page and back; the switch-off can wait for the other browsers.
  info.setTimeout(info.title.startsWith(SWITCHES_OFF) ? 300_000 : 120_000);
  if (!info.title.startsWith(SWITCHES_OFF)) release = await holdConnectOn();
});
test.afterEach(() => {
  release?.();
  release = null;
});

test("AC-1, AC-3, AC-4, AC-17: add a card (phone asked there), come back, nothing bought; Buy now places one card order", async ({ page }) => {
  const buyer = await cardBuyer({ phone: null });
  const r = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy);
  await signIn(page, buyer.creds);
  await page.goto(`/rounds/${r.roundId}/buy?ideas=${r.ideaId}`);

  const cost = page.getByRole("list", { name: "What it costs" });
  await expect(cost).toContainText(/GiftsAF fee\W*i?\$3\.05/);
  await expect(cost).toContainText("Most you'll pay");
  await expect(page.getByRole("button", { name: /Buy now/ })).toHaveCount(0);
  await page.getByLabel("Your phone").fill("(555) 123-4567");
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");

  // Back on the same gift, with the card saved, and nothing bought.
  await page.waitForURL(`**/rounds/${r.roundId}/buy?ideas=${r.ideaId}`);
  await expect(page.getByText("Saved card")).toBeVisible();
  expect(await ordersOf(r.roundId)).toEqual([]);
  expect(await cardOrdersAtZinc(r.roundId)).toBe(0);
  expect(await savedCardOf(buyer.id)).toMatch(/^pm_/);
  expect((await rest<{ buyer_phone: string }[]>(`accounts?select=buyer_phone&user_id=eq.${buyer.id}`))[0].buyer_phone).toBe("5551234567");

  await page.getByRole("button", { name: "Buy now · about $25.64" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ordered" })).toBeVisible();
  const orders = await ordersOf(r.roundId);
  expect(orders).toHaveLength(1);
  expect(orders[0].status).not.toBe("failed");
  expect(await cardOrdersAtZinc(r.roundId)).toBe(1);

  // Settings shows the card read from Stripe. While the order is still being bought (`placing`),
  // Remove is refused and the card stays (AC-13). Zinc's answer or the sweep can move the order on
  // at any moment, so it's held in `placing` here rather than raced.
  await rest(`orders?id=eq.${orders[0].id}`, { method: "PATCH", body: { status: "placing" } });
  await page.goto("/settings/paying");
  await expect(page.getByText("Visa ending in 4242")).toBeVisible();
  await page.getByRole("button", { name: "Remove card" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A gift is being bought with this card." })).toBeVisible();
  await pictures(page, "4b-settings-remove-refused");
  expect(await savedCardOf(buyer.id)).toMatch(/^pm_/);
});

test("AC-2: Back on Stripe's page saves nothing and says so on the gift", async ({ page }) => {
  const buyer = await cardBuyer();
  const r = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy);
  await signIn(page, buyer.creds);
  await page.goto(`/rounds/${r.roundId}/buy?ideas=${r.ideaId}`);
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Back");
  await page.waitForURL(`**/rounds/${r.roundId}/buy?ideas=${r.ideaId}&card=cancelled`);
  await expect(page.getByText("No card was saved. Nothing was bought.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  expect(await savedCardOf(buyer.id)).toBeNull();
  expect(await ordersOf(r.roundId)).toEqual([]);
});

test("AC-6, AC-13: a declined card fails the gift as card needed; a new card buys nothing until Buy again", async ({ page }) => {
  const buyer = await cardBuyer();
  const r = await roundWith(buyer.id, FAKE_PRODUCTS.cardDecline);
  await signIn(page, buyer.creds);
  await page.goto(`/rounds/${r.roundId}/buy?ideas=${r.ideaId}`);
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");
  await page.waitForURL(`**/rounds/${r.roundId}/buy?**`);
  await page.getByRole("button", { name: /^Buy now/ }).click();

  // The bank said no: nothing bought, and the card is cleared.
  await expect(page.getByText("Your card changed or couldn't be charged")).toBeVisible();
  let orders = await ordersOf(r.roundId);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: "failed", failure_type: "card_needed" });
  expect(await savedCardOf(buyer.id)).toBeNull();

  // The fix page offers a card; saving one comes back here and buys nothing.
  await page.goto(`/rounds/${r.roundId}/fix/${orders[0].id}`);
  await expect(page.getByText("Your card changed or couldn't be charged")).toBeVisible();
  expect(await cardOrdersAtZinc(r.roundId)).toBe(1);
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");
  await page.waitForURL(`**/rounds/${r.roundId}/fix/${orders[0].id}`);
  await expect(page.getByText("Saved card")).toBeVisible();
  expect(await ordersOf(r.roundId)).toHaveLength(1);
  expect(await cardOrdersAtZinc(r.roundId)).toBe(1);

  // Only Buy again buys, at today's price.
  await page.getByRole("button", { name: "Check today's price" }).click();
  await page.getByRole("button", { name: /^Buy again · about/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ordered" })).toBeVisible();
  orders = await ordersOf(r.roundId);
  expect(orders).toHaveLength(2);
  expect(orders[1].status).not.toBe("failed");
  expect(await cardOrdersAtZinc(r.roundId)).toBe(2);
});

test("AC-13: a held gift whose card was removed isn't bought on the card added for another gift", async ({ page }) => {
  const buyer = await cardBuyer();
  const a = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy);
  const b = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy, "Nora");
  await signIn(page, buyer.creds);

  // Gift A is approved on the first card and held, as approve_round leaves every pick before
  // placing ("held" for "retry": if the app stops before placing, the next tick places it). The
  // real approve_round writes it, with the round's lease as approval takes it, so the order saves
  // the card and fees exactly as a Buy now tap would; nothing is placed yet.
  await page.goto(`/rounds/${a.roundId}/buy?ideas=${a.ideaId}`);
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");
  await page.waitForURL(`**/rounds/${a.roundId}/buy?ideas=${a.ideaId}`);
  const firstCard = await savedCardOf(buyer.id);
  await approveHeld(buyer.id, a.roundId, a.ideaId);
  expect(await orderOf(a.roundId)).toMatchObject({ status: "held" });
  expect(await cardOrdersAtZinc(a.roundId)).toBe(0);

  // Remove the card: allowed, since A is only held.
  await page.goto("/settings/paying");
  await page.getByRole("button", { name: "Remove card" }).click();
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  expect(await savedCardOf(buyer.id)).toBeNull();

  // Add a card from gift B. Coming back buys nothing, A included.
  await page.goto(`/rounds/${b.roundId}/buy?ideas=${b.ideaId}`);
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");
  await page.waitForURL(`**/rounds/${b.roundId}/buy?ideas=${b.ideaId}`);
  await expect(page.getByText("Saved card")).toBeVisible();
  expect(await savedCardOf(buyer.id)).not.toBe(firstCard);
  expect(await ordersOf(b.roundId)).toEqual([]);
  expect(["held", "failed"]).toContain((await orderOf(a.roundId)).status);
  expect(await cardOrdersAtZinc(a.roundId)).toBe(0);

  // A's next placing try (the tick, with A due now) ends it as card needed, on no card.
  await rest(`gift_rounds?id=eq.${a.roundId}`, { method: "PATCH", body: { next_action_at: new Date().toISOString() } });
  await tick(page);
  expect(await orderOf(a.roundId)).toMatchObject({ status: "failed", failure_type: "card_needed" });
  expect(await cardOrdersAtZinc(a.roundId)).toBe(0);
  expect(await ordersOf(b.roundId)).toEqual([]);

  // Only B's Buy now buys, and only B.
  await page.getByRole("button", { name: /^Buy now/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ordered" })).toBeVisible();
  expect(await cardOrdersAtZinc(b.roundId)).toBe(1);
  expect(await cardOrdersAtZinc(a.roundId)).toBe(0);
  expect(await ordersOf(a.roundId)).toHaveLength(1);
});

test("AC-12: with paying by card off, there's no Add a card, on the gift or in Settings", async ({ page }) => {
  const buyer = await cardBuyer();
  const r = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy);
  await signIn(page, buyer.creds);
  await whileConnectOff(setConnect, async () => {
    await page.goto(`/rounds/${r.roundId}/buy?ideas=${r.ideaId}`);
    await expect(page.getByText("Buying is paused")).toBeVisible();
    await expect(page.getByRole("button", { name: /Add a card|Buy now/ })).toHaveCount(0);
    await pictures(page, "1c-buy-paused");
    await page.goto("/settings/paying");
    await expect(page.getByText("No card saved. Buying is paused right now.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
  });
});

test("AC-16: a wallet buyer sees today's buy page, with Zinc's fee and no card", async ({ page }) => {
  const buyer = await readyBuyer(await createFreshUser());
  const p = await personFor(buyer.id, "Nora");
  const r = await seedRound(buyer.id, p, { budgetCents: 4000, ideas: [{ title: "Tote", totalCents: 2300 }] });
  await signIn(page, buyer.creds);
  await page.goto(`/rounds/${r.roundId}/buy?ideas=${r.ideaIds[0]}`);
  const cost = page.getByRole("list", { name: "What it costs" });
  await expect(cost).toContainText("Zinc's order fee");
  await expect(cost).toContainText("Never more than");
  await expect(page.getByText(/taken from your Zinc balance/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy now · about $23" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
  await expect(page.getByText("GiftsAF fee")).toHaveCount(0);
});

// ─── layout and pictures ─────────────────────────────────────────────────────

/** Checks the page fits, then saves it light and dark (e2e/screenshots/ALL-98, for the ticket). */
async function fitsAndShoot(page: Page, name: string) {
  expect(await phoneLayoutProblems(page)).toEqual([]);
  await pictures(page, name);
}

/** The page as it is now, light and dark. Pictures only, for the ticket. */
async function pictures(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  const project = test.info().project.name;
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), scheme === "dark");
    await page.waitForTimeout(400); // the colour transitions
    await page.screenshot({ path: path.join(SHOTS, `${project}-${name}-${scheme}.png`), fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

test("the card screens fit and look right", { tag: "@layout" }, async ({ page }) => {
  const buyer = await cardBuyer({ phone: null });
  const r = await roundWith(buyer.id, FAKE_PRODUCTS.cardBuy);
  await signIn(page, buyer.creds);
  const buy = `/rounds/${r.roundId}/buy?ideas=${r.ideaId}`;

  // 1a: no card, no phone.
  await page.goto(buy);
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  await fitsAndShoot(page, "1a-buy-no-card");

  // 4c: Settings with no card.
  await page.goto("/settings/paying");
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  await fitsAndShoot(page, "4c-settings-no-card");

  // 1b: with a card, and 2: the fee breakdown.
  await page.goto(buy);
  await page.getByLabel("Your phone").fill("5551234567");
  await page.getByRole("button", { name: "Add a card" }).click();
  await onStripe(page, "Save card");
  await page.waitForURL(`**${buy}`);
  await expect(page.getByText("Saved card")).toBeVisible();
  await fitsAndShoot(page, "1b-buy-card-saved");
  await page.getByRole("button", { name: "What's in the GiftsAF fee" }).click();
  await expect(page.getByRole("dialog")).toContainText("Launch pricing: at cost");
  await fitsAndShoot(page, "2-fee-breakdown");
  await page.getByRole("button", { name: "Done" }).click();

  // 4a: Settings with the card.
  await page.goto("/settings/paying");
  await expect(page.getByText("Visa ending in 4242")).toBeVisible();
  await fitsAndShoot(page, "4a-settings-card");

  // 3b and 3c: a card that couldn't be charged, with a card saved now.
  // The round's reason is a plain "failed"; the gift's own is the card (as placing leaves it).
  const failed = await seedFailedOrder(buyer.id, r.roundId, r.ideaId, "failed");
  await rest(`orders?id=eq.${failed}`, { method: "PATCH", body: { failure_type: "card_needed" } });
  await page.goto(`/rounds/${r.roundId}/fix/${failed}`);
  await expect(page.getByRole("button", { name: "Check today's price" })).toBeVisible();
  await fitsAndShoot(page, "3b-fix-card-saved");
  await page.getByRole("button", { name: "Check today's price" }).click();
  await expect(page.getByRole("button", { name: /^Buy again/ })).toBeVisible();
  await fitsAndShoot(page, "3c-fix-checked");

  // 3a: no card.
  await page.goto("/settings/paying");
  await page.getByRole("button", { name: "Remove card" }).click();
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  await page.goto(`/rounds/${r.roundId}/fix/${failed}`);
  await expect(page.getByRole("button", { name: "Add a card" })).toBeVisible();
  await fitsAndShoot(page, "3a-fix-no-card");
});
