import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { dayFromNow, personFor, readyBuyer, rest, seedFailedOrder, seedOrder, seedRound, type Buyer } from "./rounds";
import { signIn } from "./sign-in";

// ALL-167: the gifts in progress on Home and a person's page, against the local Supabase. Rounds are
// written as the engine and Zinc would leave them (rounds.ts). Every status line, and who can see
// what, is covered lower down; this is the one journey, plus the layout check (T62).

const IDEAS = ["Cozy throw blanket", "Lavender candle set", "Reading lamp"].map((title) => ({ title, totalCents: 4218 }));

/** Jenn choosing among three ideas, Uncle Bob with a failed order, Mom's gift shipped, and one still looking. */
async function seedAll(b: Buyer) {
  const jenn = await personFor(b.id, "Jenn");
  const choosing = await seedRound(b.id, jenn, { shipByIn: 20, ideas: IDEAS });
  const bob = await personFor(b.id, "Uncle Bartholomew of the Very Long Name, Esq.");
  const failed = await seedRound(b.id, bob, { shipByIn: 30, ideas: IDEAS });
  await seedFailedOrder(b.id, failed.roundId, failed.ideaIds[0], "price_up");
  const mom = await personFor(b.id, "Mom");
  const shipped = await seedRound(b.id, mom, { shipByIn: 1, ideas: IDEAS });
  await seedOrder(b.id, shipped.roundId, shipped.ideaIds[0], { status: "shipped", placed_at: new Date().toISOString(), est_delivery_date: dayFromNow(4) });
  await rest(`gift_rounds?id=eq.${shipped.roundId}`, { method: "PATCH", body: { status: "ordered" } });
  return { jenn, choosing, shipped };
}

const section = (page: Page) => page.getByRole("region", { name: "Gifts in progress" });

test("Home lists the gifts in progress, and each opens its round; the person's page has theirs", async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  await signIn(page, b.creds);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Add someone you buy for" })).toBeVisible();
  await expect(section(page)).toHaveCount(0);

  const { jenn, choosing, shipped } = await seedAll(b);
  await page.reload();
  const rows = section(page).getByRole("link");
  await expect(rows).toHaveText([
    /^Jenn · Birthday ?3 ideas ready · Choose by \w{3}, \w{3} \d{1,2}$/,
    /^Uncle Bartholomew.* · Birthday ?Needs a fix · Choose by \w{3}, \w{3} \d{1,2}$/,
    /^Mom · Birthday ?Shipped · due \w{3}, \w{3} \d{1,2}$/,
  ]);
  await expect(rows.nth(2)).toHaveAttribute("href", `/rounds/${shipped.roundId}`);
  // Above the people.
  const gifts = (await section(page).boundingBox())!;
  const people = (await page.getByRole("heading", { level: 1, name: "People" }).boundingBox())!;
  expect(gifts.y + gifts.height).toBeLessThanOrEqual(people.y);

  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${choosing.roundId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Gift for Jenn" })).toBeVisible();

  await page.goto(`/people/${jenn.personId}`);
  const own = section(page).getByRole("link");
  await expect(own).toHaveText([/^Birthday gift ?3 ideas ready · Choose by/]);
  await own.click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${choosing.roundId}$`));
});

test("a gift's plain link, signed out, signs in and comes back to it", async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  const { roundId } = await seedRound(b.id, await personFor(b.id, "Jenn"), { ideas: IDEAS });
  const link = `/rounds/${roundId}`;
  await page.goto(link);
  await expect(page).toHaveURL((url) => url.pathname === "/auth/login" && url.searchParams.get("next") === link);
  // The form sends you on to `next` (smoke.spec.ts); here the session is set directly (T62).
  await signIn(page, b.creds);
  await page.goto(new URL(page.url()).searchParams.get("next")!);
  await expect(page.getByRole("heading", { level: 1, name: "Gift for Jenn" })).toBeVisible();
});

test("the gifts in progress fit Home and the person's page in light and dark", { tag: "@layout" }, async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  const { jenn } = await seedAll(b);
  await signIn(page, b.creds);
  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [path, rows] of [
      ["/", 3],
      [`/people/${jenn.personId}`, 1],
    ] as const) {
      await page.goto(path);
      const links = section(page).getByRole("link");
      await expect(links).toHaveCount(rows);
      for (const link of await links.all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      problems.push(...(await phoneLayoutProblems(page)).map((p) => `${path} (${scheme}): ${p}`));
    }
  }
  expect(problems).toEqual([]);
});
