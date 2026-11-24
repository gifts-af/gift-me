import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_GATEWAY_URL } from "./fake-gateway";
import { FAKE_CHECKABLE_URL, FAKE_PRODUCTS, FAKE_ZINC_URL } from "./fake-zinc";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { phoneLayoutProblems } from "./phone-layout";
import { linkList, listFor, ordersOf, personFor, readyBuyer, rest, seedFailedOrder, seedRound, type Buyer } from "./rounds";
import { signIn } from "./sign-in";

// ALL-29: buying from a round, picking several or none, list gifts first, and fixing a gift that
// failed, against the local Supabase, the fake Zinc and the fake Gateway (global-setup.ts). Rounds,
// ideas and seeded failures are written with the service role (rounds.ts); lists and links go
// through the app's own RPCs. global-setup.ts turns buying on for the run.
//
// One journey per main path (T67); what a lower-level test already covers isn't repeated here
// (round-screen, confirm-screen and fix-screen component tests, approval-db, purchase and replace
// local-db tests, pgTAP). Every journey has its own fresh buyer and runs on the iPhone only; the
// layout checks at the end are tagged @layout (T62).
//
// The tick is global (round-engine.spec.ts ticks too, and switches the engine off around its own
// tests), so `tick` switches the engine on itself and asks again if it found it off. It runs on
// the real clock: only rounds due now move, which no other spec's round is.

const CRON_SECRET = "e2e-cron-secret";

async function setSetting(key: string, value: number) {
  await rest(`app_settings?key=eq.${key}`, { method: "PATCH", body: { value } });
}

async function tick(page: Page): Promise<void> {
  // round-engine.spec.ts switches the engine off around its own tests, in parallel, so it can be off by the time this tick runs: switch it on and try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    await setSetting("round_engine_enabled", 1);
    await setSetting("idea_engine_enabled", 1);
    const res = await page.request.get("/api/rounds/tick", { headers: { Authorization: `Bearer ${CRON_SECRET}` }, timeout: 120_000 });
    expect(res.status(), await res.text()).toBe(200);
    if (((await res.json()) as { enabled: boolean }).enabled) return;
  }
  throw new Error("The round engine kept being switched off under the tick");
}

/** How many calls the fake Zinc (or the fake Gateway) has had that contain `match`. */
async function calls(base: string, match: string): Promise<number> {
  const res = await fetch(`${base}/__calls?match=${encodeURIComponent(match)}`);
  return ((await res.json()) as { count: number }).count;
}

/** Product photos come from a store's server; here any of them is one tiny picture. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
async function photos(page: Page) {
  await page.context().route("https://images.e2e.test/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
}

async function buyer(): Promise<Buyer> {
  return readyBuyer(await createFreshUser());
}

const ideasOf = (roundId: string) =>
  rest<{ id: string; title: string; status: string; source: string; image_url: string | null }[]>(
    `gift_ideas?select=id,title,status,source,image_url&round_id=eq.${roundId}&order=rank`,
  );
const roundOf = async (roundId: string) =>
  (await rest<{ status: string }[]>(`gift_rounds?select=status&id=eq.${roundId}`))[0];
const notificationsOf = (roundId: string) => rest<{ kind: string }[]>(`notifications?select=kind&round_id=eq.${roundId}`);

// ─── buying ─────────────────────────────────────────────────────────────────

// AC-2, AC-18, AC-19. Two tabs on one link press Buy at once: one order, and the other tab is
// told nothing more was bought. Folds in "two tabs press Buy" and "an ordered round's link".
test("Buy this from the heads-up buys in two taps, a second tab buys nothing more, and the link then says Already ordered", async ({
  page,
  context,
}) => {
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    budgetCents: 5000,
    ideas: [
      { title: "Fly-tying kit", totalCents: 3000 },
      { title: "Wading socks", totalCents: 2000 },
    ],
  });
  await signIn(page, b.creds);
  const link = `/rounds/${roundId}/buy?ideas=${ideaIds[0]}`;

  // Tap 1: the email's Buy this. A second tab has the same link open.
  const tabs = [page, await context.newPage()];
  for (const tab of tabs) {
    await tab.goto(link);
    await expect(tab.getByRole("heading", { name: "Buy this for Nora?" })).toBeVisible();
  }
  const buyNow = (tab: Page) => tab.getByRole("button", { name: "Buy now · about $30" });
  for (const tab of tabs) await expect(buyNow(tab)).toBeEnabled();

  // Tap 2, in both tabs at once.
  await Promise.all(tabs.map((tab) => buyNow(tab).click()));
  const ordered = (tab: Page) => tab.getByRole("status").filter({ hasText: "Ordered" });
  const refused = (tab: Page) => tab.getByText(/^(Busy, try again|This can't be bought now)$/);
  await expect(async () => {
    const won = await Promise.all(tabs.map(async (tab) => (await ordered(tab).count()) > 0));
    const lost = await Promise.all(tabs.map(async (tab) => (await refused(tab).count()) > 0));
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(lost.filter(Boolean)).toHaveLength(1);
  }).toPass();

  const orders = await ordersOf(roundId);
  expect(orders).toEqual([expect.objectContaining({ idea_id: ideaIds[0], status: "placing" })]);
  expect(await calls(FAKE_ZINC_URL, `POST /orders Bearer ${b.zincKey}`)).toBe(1);

  // The link now says what was bought, with nothing to buy.
  await page.goto(link);
  await expect(page.getByText("Already ordered: Fly-tying kit")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy/ })).toHaveCount(0);
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByText("Already ordered: Fly-tying kit")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

// AC-3. Folds in "another account sees only …": the same pages, the other way in.
test("opening a buy link signed out signs in and comes back to it; another account sees only that it's someone else's", async ({ page }) => {
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId, ideaIds } = await seedRound(b.id, person, { ideas: [{ title: "Fly-tying kit", totalCents: 3000 }] });
  const link = `/rounds/${roundId}/buy?ideas=${ideaIds[0]}`;

  await page.goto(link);
  await expect(page).toHaveURL((url) => url.pathname === "/auth/login" && url.searchParams.get("next") === link);
  // The form sends you on to `next` (smoke.spec.ts, "a deep link survives sign-in"); here the
  // session is set directly (T62), then the page goes where the form would.
  await signIn(page, b.creds);
  await page.goto(new URL(page.url()).searchParams.get("next")!);
  await expect(page.getByRole("heading", { name: "Buy this for Nora?" })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, await createFreshUser());
  for (const path of [`/rounds/${roundId}`, link, `/rounds/${roundId}/fix/${randomUUID()}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "This gift belongs to another account" })).toBeVisible();
    await expect(page.getByText("Fly-tying kit")).toHaveCount(0);
    await expect(page.getByText("Nora")).toHaveCount(0);
  }
});

// AC-6, AC-8.
test("an over-budget pick needs Yes, pick it, and the confirm page says Buy anyway", async ({ page }) => {
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId } = await seedRound(b.id, person, {
    budgetCents: 5000,
    ideas: [
      { title: "Wading boots", totalCents: 5500 },
      { title: "Fly box", totalCents: 2000 },
    ],
  });
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}`);
  await page.getByRole("checkbox", { name: "Wading boots" }).check();
  const sheet = page.getByRole("dialog", { name: "Over budget" });
  await expect(sheet).toContainText("$55 is $5 over the $50 budget.");
  await expect(page.getByRole("link", { name: "Buy 1 gift" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Yes, pick it" }).click();
  await page.getByRole("link", { name: "Buy 1 gift" }).click();

  await expect(page.getByRole("heading", { name: "Buy this for Nora?" })).toBeVisible();
  await expect(page.getByText("$5 over Nora's $50 budget.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy anyway · $55" })).toBeVisible();
});

// ─── None of these ──────────────────────────────────────────────────────────

// AC-12, AC-12a, AC-12b, AC-13.
test("None of these saves the reason, the next tick brings new ideas and a second heads-up, and the old Buy this link says replaced", async ({
  page,
}) => {
  test.slow();
  const b = await buyer();
  const person = await personFor(b.id, "Nora", { fact: "a new fly-tying vise" });
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    ideas: [
      { title: "Plastic fly box", totalCents: 1500, productId: "B0E2ESEED1" },
      { title: "Novelty fishing mug", totalCents: 1800, productId: "B0E2ESEED2" },
    ],
  });
  // The first heads-up, as the engine sent it.
  await rest("round_sends", { method: "POST", body: { round_id: roundId, user_id: b.id, step: "heads_up" } });
  await rest("notifications", { method: "POST", body: { user_id: b.id, round_id: roundId, kind: "heads_up", sent_at: new Date().toISOString() } });
  // New ideas need the idea and round engines on (runs_after_rejection); no spec turns either off before the end.
  await setSetting("idea_engine_enabled", 1);
  await setSetting("round_engine_enabled", 1);

  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}`);
  await page.getByRole("button", { name: "None of these" }).click();
  const sheet = page.getByRole("dialog", { name: "Why not these?" });
  await sheet.getByRole("button", { name: "Not their style" }).click();
  await sheet.getByRole("button", { name: "Find new ideas" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Looking again. New ideas will come by email." })).toBeVisible();

  expect((await roundOf(roundId)).status).toBe("generating");
  expect(await rest(`rejections?select=reason_code&round_id=eq.${roundId}`)).toEqual([{ reason_code: "not_style" }, { reason_code: "not_style" }]);
  expect(await rest(`profile_facts?select=category,value,source&person_id=eq.${person.personId}&source=eq.rejection`)).toEqual([
    { category: "avoid", value: "Not their style: Plastic fly box, Novelty fishing mug", source: "rejection" },
  ]);

  // The next tick finds new ideas (the fake Gateway's) and sends their own heads-up.
  await tick(page);
  expect((await roundOf(roundId)).status).toBe("awaiting_approval");
  const ideas = await ideasOf(roundId);
  expect(ideas.filter((i) => i.status === "proposed").map((i) => i.title)).toEqual(
    expect.arrayContaining(["Streamside Rotary Fly Tying Vise", "Streamside Waterproof Fly Box"]),
  );
  expect(ideas.filter((i) => ideaIds.includes(i.id)).map((i) => i.status)).toEqual(["rejected", "rejected"]);
  const steps = (await rest<{ step: string }[]>(`round_sends?select=step&round_id=eq.${roundId}`)).map((s) => s.step);
  expect(steps).toEqual(expect.arrayContaining(["heads_up@1", "heads_up"]));
  expect((await notificationsOf(roundId)).filter((n) => n.kind === "heads_up")).toHaveLength(2);

  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByRole("checkbox", { name: "Streamside Rotary Fly Tying Vise" })).toBeEnabled();
  await expect(page.getByText("Plastic fly box")).toHaveCount(0);

  // The first email's Buy this.
  await page.goto(`/rounds/${roundId}/buy?ideas=${ideaIds[0]}`);
  await expect(page.getByText("These ideas were replaced")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy/ })).toHaveCount(0);
});

// AC-13a.
test("None of these with no search left keeps the ideas buyable and sends no email", async ({ page }) => {
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId } = await seedRound(b.id, person, {
    ideas: [
      { title: "Fly-tying kit", totalCents: 3000 },
      { title: "Wading socks", totalCents: 2000 },
    ],
  });
  // Both of the round's runs are used (idea_round_runs_max), and "Too pricey" saves no fact to earn another.
  const run = { user_id: b.id, person_id: person.personId, round_id: roundId, started_at: new Date(Date.now() - 60_000).toISOString(), outcome: "saved" };
  await rest("idea_runs", { method: "POST", body: [run, run] });

  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}`);
  await page.getByRole("button", { name: "None of these" }).click();
  const sheet = page.getByRole("dialog", { name: "Why not these?" });
  await sheet.getByRole("button", { name: "Too pricey" }).click();
  await expect(sheet.getByText("No more new ideas this time")).toBeVisible();
  await sheet.getByRole("button", { name: "Save the reason" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. These ideas are still here to buy." })).toBeVisible();

  expect((await roundOf(roundId)).status).toBe("awaiting_approval");
  expect((await ideasOf(roundId)).map((i) => i.status)).toEqual(["proposed", "proposed"]);
  expect(await rest(`rejections?select=idea_id,reason_code&round_id=eq.${roundId}`)).toEqual([{ idea_id: null, reason_code: "too_pricey" }]);
  expect(await notificationsOf(roundId)).toEqual([]);
  await expect(page.getByRole("checkbox", { name: "Fly-tying kit" })).toBeEnabled();
});

// ─── list gifts ─────────────────────────────────────────────────────────────

// AC-27, AC-28, AC-29, AC-30, AC-30a, AC-17. Folds in "after the list owner stops sharing".
test("a linked list's gifts come first, priced by the fake Zinc, with no AI call when three qualify; then the owner stops sharing", async ({
  page,
}) => {
  test.slow();
  const { listAmazon, listEtsy } = FAKE_PRODUCTS;
  const owner = await createFreshUser();
  const list = await listFor(owner, [
    { name: listAmazon.title, url: listAmazon.url, priceCents: 2000, asin: listAmazon.productId },
    { name: "Silk scarf", url: "https://www.amazon.com/dp/B0E2ELIST9", priceCents: 2500, asin: "B0E2ELIST9" },
    { name: listEtsy.title, url: listEtsy.url, priceCents: 3400 },
    { name: "Enamel camp mug", url: FAKE_CHECKABLE_URL, priceCents: 1800 },
    { name: "Beeswax candle", url: "https://www.e2e-corner-shop.test/item/42", priceCents: 1600 },
  ]);
  // Someone else claims the scarf on the shared list, signed out, as the list page lets them.
  await rest("rpc/claim_gift", {
    method: "POST",
    profile: "lists",
    token: localSupabase().publishableKey,
    body: { p_token: list.token, p_item_id: list.itemIds[1], p_name: "Bea" },
  });

  const b = await buyer();
  // A fact, so the run could ask the AI: the marker shows whether any prompt was sent for her.
  const marker = `e2e-${randomUUID()}`;
  const person = await personFor(b.id, "Nora", { fact: `anything from ${marker}` });
  await linkList(b.creds, person.personId, list.token);
  const { roundId } = await seedRound(b.id, person, { status: "generating" });

  await tick(page);
  expect((await roundOf(roundId)).status).toBe("awaiting_approval");
  const ideas = await ideasOf(roundId);
  expect(ideas.map((i) => [i.title, i.source])).toEqual([
    [listAmazon.title, "list"],
    [listEtsy.title, "list"],
    ["Enamel camp mug", "list"],
  ]);
  // Photos from Zinc's product details, never the list's own.
  expect(ideas.map((i) => i.image_url)).toEqual([listAmazon.image, listEtsy.image, null]);
  expect(await calls(FAKE_GATEWAY_URL, marker)).toBe(0);

  await photos(page);
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByRole("heading", { name: "On their list" })).toBeVisible();
  expect(await page.getByRole("checkbox").evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-label")))).toEqual([
    listAmazon.title,
    listEtsy.title,
    "Enamel camp mug",
  ]);
  const card = (title: string) => page.locator("label").filter({ has: page.getByRole("checkbox", { name: title }) });
  await expect(card("Enamel camp mug")).toContainText("Price from their list");
  await expect(card(listAmazon.title)).not.toContainText("Price from their list");
  await expect(card(listAmazon.title).getByRole("img", { name: listAmazon.title })).toHaveAttribute("src", listAmazon.image);

  const yourself = page.getByRole("region", { name: "From their list" });
  const candle = yourself.getByRole("listitem").filter({ hasText: "Beeswax candle" });
  await expect(candle.getByRole("link", { name: "Buy it yourself" })).toHaveAttribute("href", "https://www.e2e-corner-shop.test/item/42");
  const scarf = yourself.getByRole("listitem").filter({ hasText: "Silk scarf" });
  await expect(scarf).toContainText("Someone else is getting this");
  await expect(scarf).toHaveClass(/opacity-50/);
  await expect(scarf.getByRole("link")).toHaveCount(0);

  // The buyer picks the tote and reaches the confirm page; meanwhile the owner makes a new share
  // link, which cuts the buyer's (lists.handle_share_token_changed). Buy is refused.
  await page.getByRole("checkbox", { name: listAmazon.title }).check();
  await page.getByRole("link", { name: "Buy 1 gift" }).click();
  await expect(page.getByRole("heading", { name: "Buy this for Nora?" })).toBeVisible();
  const ownerId = (await rest<{ id: string }[]>(`lists?select=id&share_token=eq.${list.token}`, { profile: "lists" }))[0].id;
  await rest(`lists?id=eq.${ownerId}`, { method: "PATCH", profile: "lists", body: { share_token: randomUUID() } });
  await page.getByRole("button", { name: /^Buy now/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Their list isn't shared with you any more" })).toBeVisible();
  expect(await ordersOf(roundId)).toEqual([]);

  await page.goto(`/rounds/${roundId}`);
  await expect(card(listAmazon.title)).toContainText("No longer shared");
  await expect(page.getByRole("checkbox", { name: listAmazon.title })).toBeDisabled();
});

// ─── fixing a failed gift ───────────────────────────────────────────────────

/** The price_up round's other idea, by a fixed id so a lookup for it on load would be counted. */
const NEXT_PRODUCT_ID = "B0E2ENEXT1";

/** A snapshot of everything loading a page must not change (AC-4a). */
async function untouched(b: Buyer, roundId: string, personId: string) {
  return {
    rounds: await rest(`gift_rounds?select=id,status,budget_cents,locked_until,next_action_at,attention_reason&user_id=eq.${b.id}`),
    ideas: await rest(`gift_ideas?select=id,status,est_total_cents&round_id=eq.${roundId}&order=rank`),
    orders: await rest(`orders?select=id,status,resolved,max_price_cents&user_id=eq.${b.id}&order=created_at`),
    rejections: await rest(`rejections?select=id&user_id=eq.${b.id}`),
    budgets: await rest(`budgets?select=occasion_kind,amount_cents&person_id=eq.${personId}`),
    facts: await rest(`profile_facts?select=id,updated_at&person_id=eq.${personId}`),
    // Every call on the buyer's key but the balance: the confirm page reads it (GET /wallet/me,
    // free) to show it (AC-4); that's a read, not an act. And lookups for either idea's product,
    // on any key.
    zincOnKey: (await calls(FAKE_ZINC_URL, b.zincKey)) - (await calls(FAKE_ZINC_URL, `GET /wallet/me Bearer ${b.zincKey}`)),
    zincLookups: [await calls(FAKE_ZINC_URL, FAKE_PRODUCTS.priceUp.productId), await calls(FAKE_ZINC_URL, NEXT_PRODUCT_ID)],
  };
}

// AC-14, AC-15 (price_up). Folds in AC-4a, "loading the round, buy and fix pages changes nothing
// and calls no Zinc", on the round with a failure to fix, where loading could do the most.
test("a price_up gift is bought at the new price after Check today's price, and loading the pages changes nothing", async ({ page }) => {
  const { priceUp } = FAKE_PRODUCTS;
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  // Approved at $20, but the store wants $30 now: Zinc refuses the order, capped at about $20.
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    ideas: [
      { title: priceUp.title, totalCents: 2000, productId: priceUp.productId, url: priceUp.url },
      { title: "Fly line dressing", totalCents: 1200, productId: NEXT_PRODUCT_ID },
    ],
  });
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}/buy?ideas=${ideaIds[0]}`);
  await page.getByRole("button", { name: "Buy now · about $20" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Price went up" })).toBeVisible();
  const [failed] = await ordersOf(roundId);
  expect(failed).toMatchObject({ idea_id: ideaIds[0], status: "failed", failure_type: "price_up" });

  // Loading every page, as a person, a link scanner or a prefetch would, changes nothing and calls no Zinc.
  const before = await untouched(b, roundId, person.personId);
  const pages: [path: string, shows: string][] = [
    [`/rounds/${roundId}`, "Gift for Nora"],
    [`/rounds/${roundId}/buy?ideas=${ideaIds[1]}`, "Fly line dressing"],
    [`/rounds/${roundId}/fix/${failed.id}`, "The price went up"],
  ];
  for (const [path, shows] of pages) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
    // The page itself, not the sign-in page a redirect would answer 200 with.
    expect(new URL(res.url()).pathname, path).toBe(path.split("?")[0]);
    expect(await res.text(), path).toContain(shows);
  }
  expect(await untouched(b, roundId, person.personId)).toEqual(before);

  // The round screen links to the fix page, which checks today's price only on a tap.
  await page.goto(`/rounds/${roundId}`);
  await page.getByRole("link", { name: "Fix this" }).click();
  await expect(page.getByRole("heading", { name: "The price went up" })).toBeVisible();
  await page.getByRole("button", { name: "Check today's price" }).click();
  await expect(page.getByText(/^Now \$3\d/)).toBeVisible();
  await page.getByRole("button", { name: /^Buy at about \$3\d/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ordered" })).toBeVisible();

  const after = await ordersOf(roundId);
  expect(after).toEqual([
    expect.objectContaining({ id: failed.id, status: "failed", resolved: true }),
    expect.objectContaining({ idea_id: ideaIds[0], status: "placing" }),
  ]);
});

// AC-15 (out_of_stock).
test("an out_of_stock gift is replaced by the next-best idea", async ({ page }) => {
  const { soldOut } = FAKE_PRODUCTS;
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    ideas: [
      { title: soldOut.title, totalCents: 1800, productId: soldOut.productId, url: soldOut.url },
      { title: "Fly line dressing", totalCents: 1200 },
    ],
  });
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}/buy?ideas=${ideaIds[0]}`);
  await page.getByRole("button", { name: "Buy now · about $18" }).click();
  await expect(page.getByRole("status").filter({ hasText: "It's out of stock" })).toBeVisible();

  await page.goto(`/rounds/${roundId}`);
  await page.getByRole("link", { name: "Fix this" }).click();
  await expect(page.getByRole("heading", { name: "It's out of stock" })).toBeVisible();
  const next = page.getByRole("region", { name: "Or the next-best idea" });
  await expect(next).toContainText("Fly line dressing");
  await next.getByRole("button", { name: "Buy this instead" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ordered" })).toBeVisible();

  const orders = await ordersOf(roundId);
  expect(orders).toEqual([
    expect.objectContaining({ idea_id: ideaIds[0], status: "failed", failure_type: "out_of_stock", resolved: true }),
    expect.objectContaining({ idea_id: ideaIds[1], status: "placing" }),
  ]);
});

test("two gifts, one sold out: the page after Buy names each, the ordered one and the failed one", async ({ page }) => {
  const { soldOut } = FAKE_PRODUCTS;
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    ideas: [
      { title: soldOut.title, totalCents: 1800, productId: soldOut.productId, url: soldOut.url },
      { title: "Fly line dressing", totalCents: 1200 },
    ],
  });
  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}/buy?ideas=${ideaIds.join(",")}`);
  await page.getByRole("button", { name: "Buy now · about $30" }).click();
  const panel = page.getByRole("status").filter({ hasText: "1 of 2 gifts ordered" });
  await expect(page.getByRole("heading", { name: "Your gifts for Nora" })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: soldOut.title })).toContainText("It's out of stock");
  await expect(panel.getByRole("listitem").filter({ hasText: "Fly line dressing" })).toContainText("Ordered");
});

// ─── layout (AC-26) ─────────────────────────────────────────────────────────

/**
 * A round to look at: two gifts from the linked list (one priced from the list), two AI ideas (one
 * over the $50 budget, one with a long title), and a list gift Zinc can't buy, for Buy it yourself.
 */
async function layoutRound() {
  const owner = await createFreshUser();
  const list = await listFor(owner, [
    { name: "Waxed canvas tote", url: FAKE_PRODUCTS.listAmazon.url, priceCents: 2000, asin: FAKE_PRODUCTS.listAmazon.productId },
    { name: "Enamel camp mug", url: FAKE_CHECKABLE_URL, priceCents: 1800 },
    { name: "Hand-poured beeswax candle in a reusable ceramic jar", url: "https://www.e2e-corner-shop.test/item/42", priceCents: 1600 },
  ]);
  const b = await buyer();
  const person = await personFor(b.id, "Nora");
  await linkList(b.creds, person.personId, list.token);
  const round = await seedRound(b.id, person, {
    budgetCents: 5000,
    ideas: [
      {
        title: "Waxed canvas tote",
        totalCents: 2400,
        productId: FAKE_PRODUCTS.listAmazon.productId,
        source: "list",
        listItemId: list.itemIds[0],
        reason: "On their list",
        imageUrl: FAKE_PRODUCTS.listAmazon.image,
      },
      { title: "Enamel camp mug", totalCents: 1950, url: FAKE_CHECKABLE_URL, source: "list", listItemId: list.itemIds[1], reason: "On their list" },
      { title: "Wading boots", totalCents: 5500, productId: "B0E2ELAY01" },
      {
        title: "Streamside rotary fly-tying vise with a pedestal base and a materials clip",
        totalCents: 2600,
        productId: "B0E2ELAY02",
        reason: "They asked for a new vise, and this one turns as they tie.",
      },
    ],
  });
  return { b, person, ...round };
}

async function checkBothSchemes(page: Page, name: string, open: () => Promise<void>): Promise<string[]> {
  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open();
    problems.push(...(await phoneLayoutProblems(page)).map((p) => `${name} (${scheme}): ${p}`));
  }
  return problems;
}

test("the round screen, its over-budget sheet and its None of these sheet fit the screen", { tag: "@layout" }, async ({ page }) => {
  test.slow();
  const { b, roundId } = await layoutRound();
  await photos(page);
  await signIn(page, b.creds);
  const problems: string[] = [];
  const round = async () => {
    await page.goto(`/rounds/${roundId}`);
    await expect(page.getByRole("heading", { name: "From their list" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Wading boots" })).toBeEnabled();
  };
  problems.push(...(await checkBothSchemes(page, "Round screen", round)));
  problems.push(
    ...(await checkBothSchemes(page, "Over-budget sheet", async () => {
      await round();
      await page.getByRole("checkbox", { name: "Wading boots" }).check();
      await expect(page.getByRole("button", { name: "Yes, pick it" })).toBeVisible();
    })),
  );
  problems.push(
    ...(await checkBothSchemes(page, "None of these sheet", async () => {
      await round();
      await page.getByRole("button", { name: "None of these" }).click();
      await page.getByRole("button", { name: "Already has one" }).click();
      await expect(page.getByRole("group", { name: "Which one?" })).toBeVisible();
    })),
  );
  expect(problems).toEqual([]);
});

test("the confirm page fits the screen", { tag: "@layout" }, async ({ page }) => {
  const { b, roundId, ideaIds } = await layoutRound();
  await photos(page);
  await signIn(page, b.creds);
  const problems = await checkBothSchemes(page, "Confirm page", async () => {
    await page.goto(`/rounds/${roundId}/buy?ideas=${ideaIds[0]},${ideaIds[1]}`);
    await expect(page.getByRole("button", { name: /^Buy now/ })).toBeEnabled();
  });
  expect(problems).toEqual([]);
});

test("the fix page fits the screen", { tag: "@layout" }, async ({ page }) => {
  const { b, roundId, ideaIds } = await layoutRound();
  const orderId = await seedFailedOrder(b.id, roundId, ideaIds[3], "price_up");
  await photos(page);
  await signIn(page, b.creds);
  const problems = await checkBothSchemes(page, "Fix page", async () => {
    await page.goto(`/rounds/${roundId}/fix/${orderId}`);
    await expect(page.getByRole("button", { name: "Check today's price" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buy this instead" })).toBeVisible();
  });
  expect(problems).toEqual([]);
});
