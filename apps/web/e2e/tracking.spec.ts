import { expect, test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { phoneLayoutProblems } from "./phone-layout";
import { dayFromNow, personFor, readyBuyer, rest, seedOrder, seedRound } from "./rounds";
import { signIn } from "./sign-in";

// ALL-33: a bought gift shows where it is on the round screen, and the buyer can say it arrived,
// against the local Supabase. Orders are written with the service role as Zinc's events would
// leave them (rounds.ts), since only Zinc moves them. Each test has its own fresh buyer. The
// status lines and the refusals are covered lower down (round-screen component test,
// mark-arrived local-db test, pgTAP); this is the one journey, plus the layout check (T62).

const UPS = (n: string) => [{ carrier: "UPS", tracking_number: n, status: "in_transit", estimated_delivery_date: null, tracking_url: null }];

const orderOf = async (id: string) =>
  (await rest<{ status: string; delivered_by: string | null }[]>(`orders?select=status,delivered_by&id=eq.${id}`))[0];
const roundOf = async (id: string) => (await rest<{ status: string }[]>(`gift_rounds?select=status&id=eq.${id}`))[0];
const notificationsOf = (roundId: string) => rest<{ kind: string }[]>(`notifications?select=kind&round_id=eq.${roundId}`);

// AC-11, AC-14: a shipped gift shows its due date and the carrier's tracking page; It arrived
// marks it delivered, the round with it, and the delivered email goes.
test("a shipped gift shows Shipped, due and Track it; It arrived makes it Delivered", async ({ page }) => {
  const b = await readyBuyer(await createFreshUser());
  const person = await personFor(b.id, "Nora");
  const { roundId, ideaIds } = await seedRound(b.id, person, { budgetCents: 5000, ideas: [{ title: "Cozy throw blanket", totalCents: 4218 }] });
  const orderId = await seedOrder(b.id, roundId, ideaIds[0], {
    status: "shipped",
    placed_at: new Date().toISOString(),
    est_delivery_date: dayFromNow(5),
    packages: UPS("1ZE2E0001"),
  });
  await rest(`gift_rounds?id=eq.${roundId}`, { method: "PATCH", body: { status: "ordered" } });

  await signIn(page, b.creds);
  await page.goto(`/rounds/${roundId}`);
  const gifts = page.getByRole("region", { name: "Your gifts" });
  const item = gifts.getByRole("listitem").filter({ hasText: "Cozy throw blanket" });
  await expect(item).toContainText(/Shipped · due \w{3}, \w{3} \d{1,2} · Track it ↗/);
  const track = item.getByRole("link", { name: /Track it/ });
  await expect(track).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1ZE2E0001");
  await expect(track).toHaveAttribute("target", "_blank");

  await item.getByRole("button", { name: "It arrived" }).click();
  await expect(item).toContainText(/Delivered \w{3}, \w{3} \d{1,2}/);
  await expect(item.getByRole("button", { name: "It arrived" })).toHaveCount(0);
  expect(await orderOf(orderId)).toEqual({ status: "delivered", delivered_by: "buyer" });
  expect((await roundOf(roundId)).status).toBe("delivered");
  expect((await notificationsOf(roundId)).filter((n) => n.kind === "delivered")).toHaveLength(1);
});

async function checkBothSchemes(page: Page, open: () => Promise<void>, shot?: string): Promise<string[]> {
  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open();
    problems.push(...(await phoneLayoutProblems(page)).map((p) => `Your gifts (${scheme}): ${p}`));
    if (shot && scheme === "light") await page.screenshot({ path: shot, fullPage: true });
  }
  return problems;
}

test("the round screen's Your gifts list fits the screen in light and dark", { tag: "@layout" }, async ({ page }, info) => {
  const b = await readyBuyer(await createFreshUser());
  const person = await personFor(b.id, "Nora");
  // The occasion is 50 days out (seedRound: ship-by in 40, plus 10).
  const { roundId, ideaIds } = await seedRound(b.id, person, {
    budgetCents: 12000,
    ideas: [
      { title: "Cozy throw blanket", totalCents: 4218 },
      { title: "Lavender candle set", totalCents: 1840 },
      { title: "Loose-leaf tea sampler in a wooden gift box with six tins", totalCents: 1599 },
      { title: "Silk scarf", totalCents: 2900 },
      { title: "Reading lamp", totalCents: 3450 },
    ],
  });
  const placed = new Date().toISOString();
  await seedOrder(b.id, roundId, ideaIds[0], { status: "shipped", placed_at: placed, est_delivery_date: dayFromNow(5), packages: UPS("1ZE2E0002") });
  await seedOrder(b.id, roundId, ideaIds[1], { status: "shipped", placed_at: placed, est_delivery_date: dayFromNow(52), total_cents: 1840 });
  await seedOrder(b.id, roundId, ideaIds[2], { status: "placed", placed_at: placed, total_cents: 1599 });
  await seedOrder(b.id, roundId, ideaIds[3], { status: "delivered", placed_at: placed, delivered_at: placed, delivered_by: "zinc", total_cents: 2900 });
  await seedOrder(b.id, roundId, ideaIds[4], { status: "failed", failure_type: "store_cancelled", placed_at: placed, total_cents: 3450 });
  // A store cancel before the ship-by date leaves the round needing attention, so Choose another gift shows.
  await rest(`gift_rounds?id=eq.${roundId}`, { method: "PATCH", body: { status: "needs_attention", attention_reason: "failed" } });

  await signIn(page, b.creds);
  const gifts = page.getByRole("region", { name: "Your gifts" });
  const problems = await checkBothSchemes(
    page,
    async () => {
      await page.goto(`/rounds/${roundId}`);
      await expect(gifts.getByRole("listitem")).toHaveCount(5);
      await expect(gifts.getByText(/May arrive .* · 2 days late/)).toBeVisible();
      await expect(gifts.getByRole("link", { name: "Choose another gift" })).toBeVisible();
      // Buttons are greyed until the page hydrates; the picture shows them ready.
      for (const button of await gifts.getByRole("button", { name: "It arrived" }).all()) await expect(button).toBeEnabled();
    },
    // The ticket's phone picture (light), from the iPhone run only.
    info.project.name === "iphone" ? info.outputPath("round-screen-phone.png") : undefined,
  );
  expect(problems).toEqual([]);
});
