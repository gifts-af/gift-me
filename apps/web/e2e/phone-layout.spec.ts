import { expect, test } from "@playwright/test";
import { phoneLayoutProblems, scrollsSideways } from "./phone-layout";

// These check the checker, so one browser is enough: the iPhone's WebKit
// (ALL-118). They keep the @layout tag so the helpers' own guard lets them run.
test.skip(({ browserName }) => browserName !== "webkit", "tests the helper, not a page");

test("flags a visible link that's too short to tap, even at zero height", { tag: "@layout" }, async ({ page }) => {
  await page.setContent(`<a href="#" style="display:block;height:0;overflow:hidden">Collapsed</a>`);
  expect(await phoneLayoutProblems(page)).toEqual(['"Collapsed" is 0.0px tall, under 44px to tap']);
});

for (const style of ["display:none", "visibility:hidden"]) {
  test(`ignores a link hidden with ${style}`, { tag: "@layout" }, async ({ page }) => {
    await page.setContent(`<a href="#" style="${style}">Hidden</a>`);
    expect(await phoneLayoutProblems(page)).toEqual([]);
  });
}

// ALL-109: a link stretched over its card with an inset-0 ::after is tapped
// anywhere on the card, but a decorative ::after (an underline) doesn't count.
const AFTER = `<style>.stretch::after{content:"";position:absolute;inset:0}.line::after{content:"";position:absolute;left:0;bottom:0;width:100%;height:1px}</style>`;

test("measures a link stretched over its card by the card", { tag: "@layout" }, async ({ page }) => {
  await page.setContent(`${AFTER}<div style="position:relative;height:80px"><a class="stretch" href="#">Mom</a></div>`);
  expect(await phoneLayoutProblems(page)).toEqual([]);
});

test("still flags a short link whose ::after is only decoration", { tag: "@layout" }, async ({ page }) => {
  await page.setContent(`${AFTER}<div style="position:relative;height:400px"><a class="line" href="#" style="display:inline-block;height:20px">Help</a></div>`);
  expect(await phoneLayoutProblems(page)).toEqual(['"Help" is 20.0px tall, under 44px to tap']);
});

// T62: a layout check runs on all three browsers only when its test is tagged
// @layout, so the helpers refuse to run in an untagged test (ALL-107). The title
// can't say "@layout": Playwright reads any @word in a title as a tag.
test("the layout checks refuse to run in an untagged test", async ({ page }) => {
  await page.setContent(`<p>Anything</p>`);
  await expect(phoneLayoutProblems(page)).rejects.toThrow(/tag this test @layout \(T62\)/);
  await expect(scrollsSideways(page)).rejects.toThrow(/tag this test @layout \(T62\)/);
});
