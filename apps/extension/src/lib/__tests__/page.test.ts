// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";
import { canCapture, collectPage, fitScreenshot, ScreenshotTooLargeError } from "../page";

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
    const page = await collectPage(7, { jpegQuality: 80, textMax: 100, screenshotMaxBytes: 1000 });
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
    const page = await collectPage(7, { jpegQuality: 80, textMax: 50_000, screenshotMaxBytes: 1000 });
    expect(page.text.length).toBe(50_000);
  });

  it("copes with a page without a body", async () => {
    document.body.remove();
    const page = await collectPage(7, { jpegQuality: 80, textMax: 10, screenshotMaxBytes: 1000 });
    expect(page.text).toBe("");
    document.documentElement.appendChild(document.createElement("body"));
  });
  it("throws ScreenshotTooLargeError when the screenshot can't be shrunk under the limit", async () => {
    const encode = vi.fn(async () => new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    await expect(
      collectPage(7, { jpegQuality: 80, textMax: 10, screenshotMaxBytes: 2 }, { encode }),
    ).rejects.toBeInstanceOf(ScreenshotTooLargeError);
  });
});

describe("fitScreenshot", () => {
  const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });

  it("passes an under-limit blob through untouched", async () => {
    const blob = jpeg(100);
    const encode = vi.fn();
    expect(await fitScreenshot(blob, 100, 70, { encode })).toBe(blob);
    expect(encode).not.toHaveBeenCalled();
  });

  it("re-encodes the original at a smaller scale until it fits", async () => {
    const blob = jpeg(1000);
    const sizes = [600, 300];
    const encode = vi.fn(async () => jpeg(sizes.shift()!));
    const out = await fitScreenshot(blob, 400, 70, { encode });
    expect(out?.size).toBe(300);
    expect(out?.type).toBe("image/jpeg");
    expect(encode).toHaveBeenCalledTimes(2);
    const [first, second] = encode.mock.calls as unknown as [Blob, number, number][];
    expect(first[0]).toBe(blob);
    expect(first[1]).toBeCloseTo(Math.sqrt(400 / 1000) * 0.9);
    expect(first[2]).toBe(70);
    expect(second[0]).toBe(blob);
    expect(second[1]).toBeCloseTo(first[1] * Math.sqrt(400 / 600) * 0.9);
  });

  it("gives up after 3 tries", async () => {
    const encode = vi.fn(async () => jpeg(500));
    expect(await fitScreenshot(jpeg(1000), 400, 70, { encode })).toBeNull();
    expect(encode).toHaveBeenCalledTimes(3);
  });
});
