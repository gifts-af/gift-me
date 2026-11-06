import { test, type Page } from "@playwright/test";

// Layout tests run on all three browsers only when tagged (T62, ALL-107), so
// every layout check here refuses to run in an untagged test.
function requireLayoutTag() {
  if (!test.info().tags.includes("@layout")) {
    throw new Error(
      `"${test.info().title}" checks layout, so tag this test @layout (T62): ` +
        `test("…", { tag: "@layout" }, async ({ page }) => …). Untagged tests run on the iPhone only.`,
    );
  }
}

/** How many pixels the page scrolls sideways; 0 means it fits the screen. */
export async function scrollsSideways(page: Page): Promise<number> {
  requireLayoutTag();
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
}

// The smallest comfortable tap target (Apple's Human Interface Guidelines).
export const MIN_TAP_PX = 44;

/**
 * What would make a page awkward on a phone, in plain words (ALL-60): it
 * scrolls sideways, a link button is too small to tap, or text runs past the
 * edge of the screen. An empty list means it's fine.
 */
export async function phoneLayoutProblems(page: Page): Promise<string[]> {
  requireLayoutTag();
  return page.evaluate((minTap) => {
    const problems: string[] = [];
    const width = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > width) problems.push(`scrolls sideways: ${scrollWidth}px of content on a ${width}px screen`);

    for (const link of document.querySelectorAll("a")) {
      const { height } = link.getBoundingClientRect();
      // A hidden link can't be tapped, such as a page kept in the background.
      if (link.checkVisibility({ checkVisibilityCSS: true }) && height < minTap) {
        problems.push(`"${link.textContent?.trim()}" is ${height.toFixed(1)}px tall, under ${minTap}px to tap`);
      }
    }

    for (const el of document.body.querySelectorAll("*")) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!ownText) continue;
      const { right } = el.getBoundingClientRect();
      if (right > width + 0.5) problems.push(`"${el.textContent?.trim().slice(0, 40)}" runs past the edge`);
    }
    return problems;
  }, MIN_TAP_PX);
}
