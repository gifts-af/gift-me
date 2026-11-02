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

test("every email sample was rendered: eight concierge, five forms (ALL-71)", () => {
  expect(samples.map((s) => s.name).sort()).toEqual(
    [
      "final_notice",
      "heads_up-auto_buy",
      "heads_up-reminder",
      "needs_address",
      "needs_attention",
      "reaction_prompt",
      "reminder",
      "test",
      "access-owner",
      "access-confirmation",
      "waitlist-owner",
      "waitlist-confirmation",
      "feedback-owner",
    ].sort(),
  );
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const { name, html } of samples) {
    test(`${name} email fits a phone (${colorScheme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.setContent(html);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${colorScheme}.png`),
        fullPage: true,
      });
      expect(await phoneLayoutProblems(page)).toEqual([]);
    });
  }
}

test("the checks catch a broken email", async ({ page }) => {
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
