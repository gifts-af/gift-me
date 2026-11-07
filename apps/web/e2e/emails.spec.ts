import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { phoneLayoutProblems } from "./phone-layout";

// ALL-60: every email sample on an iPhone (WebKit, what iPhone Mail uses) and
// an Android phone (Chromium), in light and dark. The Gmail app's own CSS
// rewriting can't be reproduced here; see the ticket.
// The emails come from `pnpm email:html`, because the templates sit behind the
// concierge module's server-only index.
function renderSamples(): { name: string; html: string }[] {
  const dir = mkdtempSync(path.join(tmpdir(), "giftsaf-emails-"));
  execSync(`pnpm -s email:html "${dir}"`, { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ name: f.replace(/\.html$/, ""), html: readFileSync(path.join(dir, f), "utf8") }));
}

const samples = renderSamples();

test("every email sample was rendered: 28 concierge, five forms (ALL-71, ALL-32)", () => {
  expect(samples.map((s) => s.name).sort()).toEqual(
    [
      "final_notice",
      "heads_up-auto_buy",
      "heads_up-reminder",
      "needs_address",
      "needs_attention",
      "reaction_prompt",
      "reminder",
      "reminder-questions",
      "skipped",
      "skipped-held",
      "skipped-partial",
      "ordered",
      "heads_up-funding",
      "hold_funds",
      "hold_funds-still",
      "hold_setup",
      "hold_address",
      "hold_trouble",
      "hold_unconfirmed",
      "price_up",
      "out_of_stock",
      "too_late",
      "missed_on_us",
      "failed_late",
      "failed_late-partial",
      "check_your_address",
      "test",
      "access-owner",
      "access-confirmation",
      "waitlist-owner",
      "waitlist-confirmation",
      "feedback-owner",
    ].sort(),
  );
});

// One page per sample, checked in light and then dark (ALL-118): switching the
// color scheme re-applies the email's media queries without loading it again.
// A screenshot is taken only when a check fails, since screenshots were 40% of
// this spec's time; to look at the emails themselves, open `pnpm email:html`'s files.
for (const { name, html } of samples) {
  test(`${name} email fits a phone, light and dark`, { tag: "@layout" }, async ({ page }, testInfo) => {
    await page.setContent(html);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const problems = await phoneLayoutProblems(page);
      if (problems.length > 0) {
        const file = testInfo.outputPath(`${name}-${colorScheme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        await testInfo.attach(`${name}-${colorScheme}.png`, { path: file, contentType: "image/png" });
      }
      expect.soft(problems, `${name} (${colorScheme})`).toEqual([]);
    }
  });
}

// This checks the checker, so one browser is enough (ALL-118).
test("the checks catch a broken email", { tag: "@layout" }, async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "tests the helper, not the email");
  await page.setContent(
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<body><table style="width:700px"><tr><td>Too wide for any phone</td></tr></table>` +
      `<a href="#" style="font-size:12px">tiny</a></body>`,
  );
  const problems = await phoneLayoutProblems(page);
  expect(problems.some((p) => p.startsWith("scrolls sideways"))).toBe(true);
  expect(problems.some((p) => p.includes('"tiny"') && p.includes("to tap"))).toBe(true);
  expect(problems.some((p) => p.includes("Too wide for any phone") && p.includes("past the edge"))).toBe(true);
});
