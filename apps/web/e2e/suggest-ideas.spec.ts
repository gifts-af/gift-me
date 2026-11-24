import { expect, test } from "@playwright/test";
import { FAKE_IDEAS } from "./fake-gateway";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { saveBudgets } from "./seed";
import { session, signIn } from "./sign-in";

// ALL-27: Suggest on a person's Gift ideas screen runs the real idea engine against the
// fake Gateway and the fake Zinc (global-setup.ts), so nothing spends money. Behaviour,
// so it runs on the iPhone only (T62). idea_engine_enabled ships 0: this turns it on, and
// global-setup.ts's teardown turns it off once every spec has finished.

const supabase = localSupabase();
const service = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function rest(path: string, init: RequestInit & { profile?: string; merge?: boolean } = {}) {
  const headers: Record<string, string> = { ...service, Prefer: `return=representation${init.merge ? ",resolution=merge-duplicates" : ""}` };
  if (init.profile) {
    headers["Accept-Profile"] = init.profile;
    headers["Content-Profile"] = init.profile;
  }
  const res = await fetch(`${supabase.url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

/** A fresh buyer, paid or not, with one person who has one fact and a $100 budget. */
async function seed(paid: boolean) {
  const user = await createFreshUser();
  const userId = (await session(user)).user.id;
  await rest("accounts?on_conflict=user_id", {
    method: "POST",
    profile: "concierge",
    merge: true,
    body: JSON.stringify({ user_id: userId, paid_features: paid }),
  });
  const [person] = await rest("people", { method: "POST", body: JSON.stringify({ user_id: userId, name: "Ideas Ike", relationship: "father" }) });
  await rest("profile_facts", {
    method: "POST",
    profile: "concierge",
    body: JSON.stringify({ user_id: userId, person_id: person.id, category: "wants", value: "a new fly-tying vise", source: "note" }),
  });
  await saveBudgets(user, person.id, { any: 10000 });
  return { user, personId: person.id as string };
}

test.beforeAll(async () => {
  await rest("app_settings?key=eq.idea_engine_enabled", { method: "PATCH", profile: "concierge", body: JSON.stringify({ value: 1 }) });
});

const money = (cents: number) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

test("Suggest finds three checked ideas, and a second run replaces them", async ({ page }) => {
  test.setTimeout(90_000);
  const { user, personId } = await seed(true);
  await signIn(page, user);
  await page.goto(`/people/${personId}`);
  const row = page.getByRole("link", { name: /^Gift ideas/ });
  await expect(row).toHaveText(/None/);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}/ideas$`));
  await expect(page.getByRole("note")).toContainText("cost real money");

  const suggest = page.getByRole("button", { name: "Suggest ideas for Ideas Ike" });
  const ideas = page.getByRole("list", { name: "Gift ideas" }).getByRole("listitem");
  await suggest.click();
  await expect(ideas).toHaveCount(3, { timeout: 60_000 });

  // The fake Zinc's prices, in the totals the engine saved, and the fake rank's reasons.
  const saved = (await rest(
    `gift_ideas?select=retailer_product_id,price_cents,est_total_cents&person_id=eq.${personId}&round_id=is.null`,
    { profile: "concierge" },
  )) as { retailer_product_id: string; price_cents: number; est_total_cents: number }[];
  expect(saved).toHaveLength(3);
  for (const idea of FAKE_IDEAS) {
    const s = saved.find((x) => x.retailer_product_id === idea.productId);
    expect(s?.price_cents).toBe(idea.priceCents);
    const item = page.locator(`li[data-retailer-product-id="${idea.productId}"]`);
    await expect(item).toContainText(idea.productTitle);
    await expect(item).toContainText(`${money(s!.price_cents)} · Amazon`);
    await expect(item).toContainText(`About ${money(s!.est_total_cents)} with shipping, tax and fee`);
    await expect(item).toContainText(idea.reason);
    // No occasion, so no arrival date.
    await expect(item).not.toContainText("Arrives by");
  }

  // ALL-128: Save copies an idea into the person's saved gifts, so the next run doesn't lose it.
  const vise = FAKE_IDEAS[0];
  const viseItem = page.locator(`li[data-retailer-product-id="${vise.productId}"]`);
  // A second tab opened before the save still offers Save.
  const otherTab = await page.context().newPage();
  await otherTab.goto(`/people/${personId}/ideas`);
  const otherSave = otherTab.getByRole("button", { name: `Save ${vise.productTitle}` });
  await expect(otherSave).toBeVisible();

  await viseItem.getByRole("button", { name: `Save ${vise.productTitle}` }).click();
  await expect(viseItem).toContainText("Saved");
  await expect(viseItem.getByRole("button", { name: /^Save / })).toHaveCount(0);

  // Saving again from the stale tab is "Saved", with no error and no second copy (checked below).
  await otherSave.click();
  await expect(otherTab.locator(`li[data-retailer-product-id="${vise.productId}"]`)).toContainText("Saved");
  await expect(otherTab.getByRole("main").getByRole("alert")).toHaveCount(0);
  await otherTab.close();

  // Again: the set is replaced, not added to.
  await expect(suggest).toBeEnabled();
  await suggest.click();
  await expect(suggest).toBeDisabled();
  await expect(suggest).toBeEnabled({ timeout: 60_000 });
  // Scoped to the page's own content: Next's route announcer is an empty alert too.
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(ideas).toHaveCount(3);
  // The new run's copy of the same product still shows as saved; the others can still be saved.
  await expect(viseItem).toContainText("Saved");
  await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(2);
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("link", { name: /^Gift ideas/ })).toHaveText(/3/);
  await page.goto(`/people/${personId}/saved-gifts`);
  const savedGifts = page.getByRole("region", { name: "Saved gifts" }).getByRole("listitem");
  await expect(savedGifts).toHaveCount(1);
  await expect(savedGifts).toContainText(vise.productTitle);
  // The same price on both screens.
  await expect(savedGifts).toContainText(`${money(vise.priceCents)} · Amazon`);
});

test("without paid features there's no button, only the line saying why", async ({ page }) => {
  const { user, personId } = await seed(false);
  await signIn(page, user);
  await page.goto(`/people/${personId}/ideas`);
  await expect(page.getByText("Gift ideas aren't available on your account yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Suggest ideas/ })).toHaveCount(0);
});
