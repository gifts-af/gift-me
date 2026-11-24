import { expect, test, type Page } from "@playwright/test";

// On giftsaf.com: what a signed-out visitor and a link preview see for
// the QA account's share link. Read only: it opens the link in a browser with
// no session and fetches the preview, and never adds a person (Production test
// account > Rules). Run with `pnpm live-check e2e-live/all-123-share-signed-out.spec.ts`.

// The QA account's display name on production (Settings > Name).
const OWNER = "GiftsAF QA";

/** The QA account's share link, from its own Share button. Skip writes nothing. */
async function qaShareUrl(page: Page): Promise<string> {
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

/** The preview tags in <head>, read by a real HTML parser so names with ' or & compare as written. */
async function previewTags(page: Page, html: string) {
  return page.evaluate((source) => {
    const head = new DOMParser().parseFromString(source, "text/html").head;
    const meta = [...head.querySelectorAll("meta[content]")].map((tag) => ({
      key: tag.getAttribute("property") ?? tag.getAttribute("name") ?? "",
      content: tag.getAttribute("content") ?? "",
    }));
    return { title: head.querySelector("title")?.textContent ?? null, meta };
  }, html);
}

test("signed out: whose list it is, and Sign in or Request access", async ({ page, browser, baseURL }) => {
  const url = await qaShareUrl(page);
  const visitor = await browser.newContext({ storageState: undefined, baseURL, viewport: page.viewportSize() ?? undefined });
  const p = await visitor.newPage();
  try {
    await p.goto(new URL(url).pathname);
    await expect(p.getByRole("heading", { level: 1, name: `${OWNER}'s list`, exact: true })).toBeVisible();
    const card = p.getByRole("region", { name: "This list and your people" });
    await expect(card.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /^\/auth\/login\?next=/);
    await expect(card.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    // The Get and Give bar is for signed-in people.
    await expect(p.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await p.screenshot({ path: test.info().outputPath("signed-out.png"), fullPage: true });
  } finally {
    await visitor.close();
  }
});

test("the link preview: noindex, the owner's name, an image, and no gift details", async ({ page, request }) => {
  const url = await qaShareUrl(page);
  const path = new URL(url).pathname;
  const response = await request.get(path, { headers: AS_BOT });
  expect(response.status()).toBe(200);
  const { meta } = await previewTags(page, await response.text());
  const contents = (key: string) => meta.filter((tag) => tag.key === key).map((tag) => tag.content);
  expect(contents("robots")).toContain("noindex, nofollow");
  expect(contents("og:title")).toEqual([`${OWNER}'s wish list on GiftsAF`]);

  const image = await request.get(`${path}/opengraph-image`, { headers: AS_BOT });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  await test.info().attach("preview.png", { body: await image.body(), contentType: "image/png" });

  // The list's gift names never reach the preview tags. Wait for the gifts, or
  // the loop would check nothing. Image addresses hold ids, so a short name
  // could match one by chance.
  await page.goto("/lists");
  const names = page.locator("article h3");
  await expect(names.first()).toBeVisible();
  const gifts = (await names.allTextContents()).map((name) => name.trim()).filter(Boolean);
  expect(gifts.length).toBeGreaterThan(0);
  const text = meta.filter((tag) => !tag.content.startsWith("https://")).map((tag) => tag.content).join("\n");
  for (const gift of gifts) expect(text).not.toContain(gift);
});

test("an unknown link previews as plain GiftsAF, with no name", async ({ page, request }) => {
  const path = "/share/00000000-0000-4000-8000-000000000000";
  const response = await request.get(path, { headers: AS_BOT });
  // 200, not 404: the page has started streaming before the list is looked up.
  expect(response.status()).toBe(200);
  const { title, meta } = await previewTags(page, await response.text());
  expect(title).toBe("GiftsAF");
  expect(meta.filter((tag) => tag.key === "og:title").map((tag) => tag.content)).toEqual(["GiftsAF · Gifting, handled AF."]);
  expect(meta.map((tag) => tag.content).join("\n")).not.toContain("wish list on");
});
