import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { addMother, saveOneGiftList } from "./seed";
import { signIn, session, type Credentials } from "./sign-in";

// Screenshots for the gallery (ALL-000, see playwright.gallery.config.ts).
// Add a screen by adding a line to SIGNED_OUT or SIGNED_IN.
const GALLERY_DIR = path.resolve(__dirname, "../gallery");

async function shoot(page: Page, name: string) {
  // Not "networkidle": the Turnstile widget keeps Chromium busy on the form pages.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
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

// Filled in by beforeAll: a fresh account with one person and a one-gift list.
type Seeded = { user: Credentials; personId: string; shareToken: string };
const SIGNED_IN: [name: string, url: (s: Seeded) => string][] = [
  ["home", () => "/"],
  ["my-list", () => "/lists"],
  ["person", (s) => `/people/${s.personId}`],
  ["person-questions", (s) => `/people/${s.personId}/questions`],
  ["add-person", () => "/people/new"],
  ["import-people", () => "/people/import"],
  ["settings", () => "/settings"],
  ["shared-list", (s) => `/share/${s.shareToken}`],
];

for (const [name, url] of SIGNED_OUT) {
  test(`signed out: ${name}`, async ({ page }) => {
    await page.goto(url);
    await shoot(page, name);
  });
}

test.describe("signed in", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const user = await createFreshUser();
    const personId = await addMother(user, "Mom");
    await saveOneGiftList(user);
    seeded = { user, personId, shareToken: await shareToken(user) };
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
