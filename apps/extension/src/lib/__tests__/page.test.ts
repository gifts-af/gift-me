// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";
import { canCapture, collectPage } from "../page";

let fake: FakeChrome;
beforeEach(() => {
  fake = installFakeChrome();
  document.title = "Stoneware mug set";
  document.body.textContent = "A lovely mug.";
  // jsdom has no layout, so it doesn't implement innerText; textContent stands in.
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent;
    },
  });
});

describe("canCapture", () => {
  it("is true when a script can run in the tab", async () => {
    expect(await canCapture(7)).toBe(true);
    expect(fake.scripting.calls[0].target).toEqual({ tabId: 7 });
  });

  it("is false when the browser refuses (chrome://, Web Store)", async () => {
    fake.scripting.blocked = true;
    expect(await canCapture(7)).toBe(false);
  });
});

describe("collectPage", () => {
  it("reads url, title and text from the page and screenshots it as JPEG", async () => {
    const page = await collectPage(7, { jpegQuality: 80, textMax: 100 });
    expect(page.url).toBe(location.href);
    expect(page.title).toBe("Stoneware mug set");
    expect(page.text).toBe("A lovely mug.");
    expect(fake.scripting.calls[0]).toMatchObject({ target: { tabId: 7 }, args: [100] });
    expect(fake.tabs.captures).toEqual([{ format: "jpeg", quality: 80 }]);
    expect(page.screenshot.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await page.screenshot.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it("collectPage on 1 MB of text sends at most textMax chars", async () => {
    document.body.textContent = "x".repeat(1024 * 1024);
    const page = await collectPage(7, { jpegQuality: 80, textMax: 50_000 });
    expect(page.text.length).toBe(50_000);
  });

  it("copes with a page without a body", async () => {
    document.body.remove();
    const page = await collectPage(7, { jpegQuality: 80, textMax: 10 });
    expect(page.text).toBe("");
    document.documentElement.appendChild(document.createElement("body"));
  });
});
