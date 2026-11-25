import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { personFor, readyBuyer, rest, seedFailedOrder, seedOrder, seedPastGifts, seedRound, type PastGiftsSeed } from "./rounds";
import { addMother, addSavedGift, linkListWithPhotos, saveBudgets, saveOneGiftList } from "./seed";
import { signIn, session, type Credentials } from "./sign-in";

// Screenshots for the gallery (ALL-000, see playwright.gallery.config.ts).
// Add a screen by adding a line to SIGNED_OUT or SIGNED_IN.
const GALLERY_DIR = path.resolve(__dirname, "../gallery");

async function shoot(page: Page, name: string) {
  // Not "networkidle": the Turnstile widget keeps Chromium busy on the form pages.
  await page.waitForLoadState("load");
  // Streamed pages show "Loading…" first; shoot what follows it.
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Settings (and others) show "Loading…" while data streams in; wait for the real content.
  await page.waitForFunction(
    () => ![...document.querySelectorAll("body *")].some((el) => el.children.length === 0 && /^Loading/.test(el.textContent?.trim() ?? "")),
  );
  // ALL-110 fades controls until hydration; wait for the fade to clear, but never fail the shot.
  try {
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[aria-disabled="true"]')].some((el) =>
          /aria-disabled:opacity/.test(el.getAttribute("class") ?? ""),
        ),
      undefined,
      { timeout: 5000 },
    );
  } catch {
    // A control that is really disabled keeps the class; shoot anyway.
  }
  const file = path.join(GALLERY_DIR, test.info().project.name, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

const SIGNED_OUT: [name: string, url: string][] = [
  ["welcome", "/welcome"],
  ["tour", "/tour"],
  ["tour-list", "/tour/list"],
  ["request-access", "/request-access"],
  ["login", "/auth/login"],
  ["sign-up", "/auth/sign-up"],
  ["forgot-password", "/auth/forgot-password"],
];

// Filled in by beforeAll: a fresh account with one person (with a saved gift) and a one-gift list,
// plus a round awaiting approval and another with a gift to fix (ALL-29).
type Seeded = { user: Credentials; personId: string; linkedId: string; dadId: string; heldId: string; shareToken: string; round: { id: string; ideaIds: string[] }; fix: { roundId: string; orderId: string }; past: PastGiftsSeed };
const SIGNED_IN: [name: string, url: (s: Seeded) => string][] = [
  ["home", () => "/give"],
  ["my-list", () => "/lists"],
  ["person", (s) => `/people/${s.personId}`],
  ["person-linked-list", (s) => `/people/${s.linkedId}`],
  ["person-gift-in-progress", (s) => `/people/${s.dadId}`],
  ["person-questions", (s) => `/people/${s.personId}/questions`],
  ["person-budget", (s) => `/people/${s.personId}/budget`],
  ["person-about", (s) => `/people/${s.personId}/about`],
  ["person-saved-gifts", (s) => `/people/${s.personId}/saved-gifts`],
  ["person-address", (s) => `/people/${s.personId}/address`],
  ["person-ideas", (s) => `/people/${s.personId}/ideas`],
  ["person-past-gifts", (s) => `/people/${s.past.personId}/gifts`],
  ["add-person", () => "/people/new"],
  ["import-people", () => "/people/import"],
  ["settings", () => "/settings"],
  ["settings-over-budget", () => "/settings/over-budget"],
  ["settings-reminders", () => "/settings/reminders"],
  ["settings-address", () => "/settings/address"],
  ["settings-paying", () => "/settings/paying"],
  ["shared-list", (s) => `/share/${s.shareToken}`],
  ["round", (s) => `/rounds/${s.round.id}`],
  ["round-held", (s) => `/rounds/${s.heldId}`],
  ["round-buy", (s) => `/rounds/${s.round.id}/buy?ideas=${s.round.ideaIds.slice(0, 2).join(",")}`],
  ["round-fix", (s) => `/rounds/${s.fix.roundId}/fix/${s.fix.orderId}`],
  ["round-reaction", (s) => `/rounds/${s.past.roundId}/reaction?gift=${s.past.unanswered.orderId}&r=loved`],
];

for (const [name, url] of SIGNED_OUT) {
  test(`signed out: ${name}`, async ({ page }) => {
    await page.goto(url);
    await shoot(page, name);
  });
}

test.describe("signed in", () => {
  let seeded: Seeded;
  test.beforeAll(async ({}, testInfo) => {
    // Every worker seeds its own user with several sign-ins at once, which ran close to the
    // default 30 s on a laptop even before ALL-128 added a saved idea.
    test.setTimeout(60_000);
    const user = await createFreshUser();
    const personId = await addMother(user, "Mom");
    await addSavedGift(user, personId, "Fly-fishing reel");
    await saveBudgets(user, personId, { any: 7500, mothers_day: 5000 });
    await addOnDemandIdeas(user, personId);
    await saveOneGiftList(user);
    const linkedId = await addMother(user, "Grandma Rose");
    const photo = (n: number) => `${testInfo.project.use.baseURL}/pwa-icon/192?v=${n}`;
    await linkListWithPhotos(await createFreshUser(), user, linkedId, [1, 2, 3].map(photo));
    seeded = { user, personId, linkedId, shareToken: await shareToken(user), ...(await addRounds(user)) };
  });

  for (const [name, url] of SIGNED_IN) {
    test(name, async ({ page }) => {
      await signIn(page, seeded.user);
      await page.goto(url(seeded));
      await shoot(page, name);
    });
  }
});

// Emails are read on phones, and their colors don't follow dark mode, so only the light phone.
test("emails", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "emails are shot on the light phone only");
  const dir = mkdtempSync(path.join(tmpdir(), "giftsaf-gallery-emails-"));
  execSync(`pnpm -s email:html "${dir}"`, { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    await page.setContent(readFileSync(path.join(dir, file), "utf8"));
    await shoot(page, `email-${file.replace(/\.html$/, "")}`);
  }
});

// Two on-demand ideas (one over budget), written as the engine would save them, so the Gift ideas
// screen shows its rows without a run (a run spends money; ALL-27). The engine stays off, so the
// screen's off line shows above them.
async function addOnDemandIdeas(user: Credentials, personId: string): Promise<void> {
  const { url, serviceRoleKey, publishableKey } = localSupabase();
  const { user: me, access_token } = await session(user);
  const row = (rank: number, title: string, cents: number, over: boolean, reason: string) => ({
    user_id: me.id,
    person_id: personId,
    title,
    retailer: "amazon",
    product_url: `https://www.amazon.com/dp/B0GALLERY${rank}`,
    retailer_product_id: `B0GALLERY${rank}`,
    price_cents: cents,
    est_total_cents: cents + 500,
    arrive_by: "2026-12-10",
    reason,
    over_budget: over,
    rank,
  });
  const res = await fetch(`${url}/rest/v1/gift_ideas`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify([
      row(1, "Fly-tying vise", 6900, false, "She mentioned wanting to tie her own flies."),
      row(2, "Waterproof wading boots", 9400, true, "Hers are worn through, and the season starts soon."),
    ]),
  });
  if (!res.ok) throw new Error(`saving ideas failed: ${res.status} ${await res.text()}`);
  // The vise is already in her saved gifts, so the screen shows both Save and Saved (ALL-128).
  // As the buyer: the saved-gifts trigger checks who's saving.
  const saved = await fetch(`${url}/rest/v1/saved_gifts`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({
      person_id: personId,
      name: "Fly-tying vise",
      price_cents: 6900,
      product_url: "https://www.amazon.com/dp/B0GALLERY1",
      retailer_product_id: "B0GALLERY1",
    }),
  });
  if (!saved.ok) throw new Error(`saving the vise failed: ${saved.status} ${await saved.text()}`);
}

// A round awaiting approval for Dad (one idea over his budget), and one for Grandpa whose first
// pick's price went up, written as the engine and Zinc would leave them (ALL-29). The buyer can buy,
// so the confirm page shows the fake Zinc's balance.
async function addRounds(user: Credentials): Promise<Pick<Seeded, "dadId" | "heldId" | "round" | "fix" | "past">> {
  const { id } = await readyBuyer(user);
  const ideas = [
    { title: "Rotary fly-tying vise", totalCents: 3150, productId: "B0GALLERY3", reason: "He asked for a new vise, and this one turns as he ties." },
    { title: "Waterproof fly box", totalCents: 1890, productId: "B0GALLERY4", reason: "Keeps the flies he ties dry on the river." },
    { title: "Wading boots", totalCents: 8400, productId: "B0GALLERY5", reason: "His are worn through, and the season starts soon." },
  ];
  const dad = await personFor(id, "Dad");
  const round = await seedRound(id, dad, { budgetCents: 7500, ideas });
  const grandpa = await personFor(id, "Grandpa");
  const fixRound = await seedRound(id, grandpa, { budgetCents: 7500, ideas });
  const orderId = await seedFailedOrder(id, fixRound.roundId, fixRound.ideaIds[0], "price_up");
  const held = await seedRound(id, await personFor(id, "Uncle Bob"), { budgetCents: 7500, ideas });
  await seedOrder(id, held.roundId, held.ideaIds[0], { status: "held", hold_reason: "funds", provider_order_id: null, total_cents: null });
  await rest(`gift_rounds?id=eq.${held.roundId}`, { method: "PATCH", body: { status: "needs_attention", attention_reason: "funds" } });
  return { heldId: held.roundId, dadId: dad.personId, round: { id: round.roundId, ideaIds: round.ideaIds }, fix: { roundId: fixRound.roundId, orderId }, past: await seedPastGifts(id, "Nora") };
}

async function shareToken(user: Credentials): Promise<string> {
  const { url, publishableKey } = localSupabase();
  const { access_token, user: me } = await session(user);
  const res = await fetch(`${url}/rest/v1/lists?select=share_token&owner_id=eq.${me.id}`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${access_token}`, "Accept-Profile": "lists" },
  });
  if (!res.ok) throw new Error(`Couldn't read the share token: ${res.status} ${await res.text()}`);
  const [row] = (await res.json()) as { share_token: string }[];
  if (!row) throw new Error("The seeded list has no share token");
  return row.share_token;
}
