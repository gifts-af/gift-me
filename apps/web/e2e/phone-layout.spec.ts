import { expect, test } from "@playwright/test";
import { phoneLayoutProblems, scrollsSideways } from "./phone-layout";

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

// T62: a layout check runs on all three browsers only when its test is tagged
// @layout, so the helpers refuse to run in an untagged test (ALL-107). The title
// can't say "@layout": Playwright reads any @word in a title as a tag.
test("the layout checks refuse to run in an untagged test", async ({ page }) => {
  await page.setContent(`<p>Anything</p>`);
  await expect(phoneLayoutProblems(page)).rejects.toThrow(/tag this test @layout \(T62\)/);
  await expect(scrollsSideways(page)).rejects.toThrow(/tag this test @layout \(T62\)/);
});
