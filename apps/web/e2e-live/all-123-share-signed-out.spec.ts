import { expect, test } from "@playwright/test";

// ALL-123 on giftsaf.com: what a signed-out visitor and a link preview see for
// the QA account's share link. Read only: it opens the link in a browser with
// no session and fetches the preview, and never adds a person (Production test
// account > Rules). Run with `pnpm live-check e2e-live/all-123-share-signed-out.spec.ts`.

/** The QA account's share link, from its own Share button. Skip writes nothing. */
async function qaShareUrl(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/lists");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await page.getByRole("button", { name: /Share/ }).click();
  const skip = page.getByRole("dialog", { name: "What name should your list show?" }).getByRole("button", { name: "Skip" });
  if ((await skip.count()) > 0) await skip.click();
  const field = page.getByLabel("Share link");
  await expect(field).toHaveValue(/\/share\//);
  return field.inputValue();
}

// Next streams metadata into the body for browsers and puts it in <head> only
// for known preview bots, so fetch as one, the way Slack unfurls a link.
const AS_BOT = { cookie: "", "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" };

test("signed out: whose list it is, and Sign in or Request access", async ({ page, browser, baseURL }) => {
  const url = await qaShareUrl(page);
  const visitor = await browser.newContext({ storageState: undefined, baseURL, viewport: page.viewportSize() ?? undefined });
  const p = await visitor.newPage();
  try {
    await p.goto(new URL(url).pathname);
    const ogTitle = await p.locator('meta[property="og:title"]').getAttribute("content").catch(() => null);
    const name = ogTitle?.match(/^(.*)'s wish list on GiftsAF$/)?.[1] ?? null;
    // The heading names the owner when they have a display name, else "Their list".
    await expect(p.getByRole("heading", { level: 1, name: name ? `${name}'s list` : "Their list" })).toBeVisible();
    const card = p.getByRole("region", { name: "This list and your people" });
    await expect(card.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /^\/auth\/login\?next=/);
    await expect(card.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    // No claims shown to a visitor who can't claim yet, and no Get and Give bar.
    await expect(p.getByRole("link", { name: "Give" })).toHaveCount(0);
    await p.screenshot({ path: test.info().outputPath("signed-out.png"), fullPage: true });
  } finally {
    await visitor.close();
  }
});

test("the link preview: noindex, a name or nothing, an image, and no gift details", async ({ page, request }) => {
  const url = await qaShareUrl(page);
  const path = new URL(url).pathname;
  const html = await (await request.get(path, { headers: AS_BOT })).text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toMatch(/<meta name="robots" content="noindex[^"]*"/);
  const title = head.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? null;
  if (title) expect(title.replaceAll("&#x27;", "'")).toMatch(/^.+'s wish list on GiftsAF$/);

  const image = await request.get(`${path}/opengraph-image`, { headers: AS_BOT });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  await test.info().attach("preview.png", { body: await image.body(), contentType: "image/png" });

  // The list's gift names never reach the preview tags.
  await page.goto("/lists");
  const gifts = await page.locator("article h3, article h2").allTextContents();
  for (const gift of gifts.map((g) => g.trim()).filter(Boolean)) expect(head).not.toContain(gift);
});

test("an unknown link previews as plain GiftsAF, with no name", async ({ request }) => {
  const path = "/share/00000000-0000-4000-8000-000000000000";
  const html = await (await request.get(path, { headers: AS_BOT })).text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).not.toMatch(/wish list on/);
  expect(head).toMatch(/<title>GiftsAF<\/title>/);
});
