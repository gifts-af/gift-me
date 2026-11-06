import { expect, test } from "@playwright/test";
import { phoneLayoutProblems } from "./phone-layout";

test("flags a visible link that's too short to tap, even at zero height", async ({ page }) => {
  await page.setContent(`<a href="#" style="display:block;height:0;overflow:hidden">Collapsed</a>`);
  expect(await phoneLayoutProblems(page)).toEqual(['"Collapsed" is 0.0px tall, under 44px to tap']);
});

test("ignores a link that's really hidden", async ({ page }) => {
  await page.setContent(`<a href="#" style="display:none">Hidden</a>`);
  expect(await phoneLayoutProblems(page)).toEqual([]);
});
