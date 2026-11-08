import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { phoneLayoutProblems } from "./phone-layout";

// ALL-60: every email sample on an iPhone (WebKit, what iPhone Mail uses) and
// an Android phone (Chromium). The Gmail app's own CSS
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

test("every email sample was rendered: 30 concierge, five forms (ALL-71, ALL-32, ALL-116)", () => {
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
      "failed_late-several",
      "failed_several",
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

// Light only (ALL-118): our emails are light by design (T33) and the layout has
// no dark rule, so a dark pass checked nothing new. A screenshot is taken only
// when a check fails, since screenshots were 40% of this spec's time; to look
// at the emails themselves, open the files `pnpm email:html` writes.
for (const { name, html } of samples) {
  test(`${name} email fits a phone`, { tag: "@layout" }, async ({ page }, testInfo) => {
    await page.setContent(html);
    const problems = await phoneLayoutProblems(page);
    if (problems.length > 0) {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`${name}.png`, { path: file, contentType: "image/png" });
    }
    expect(problems).toEqual([]);
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
