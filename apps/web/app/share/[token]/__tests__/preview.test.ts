import { beforeEach, describe, expect, it, vi } from "vitest";

// ALL-123 task 7: the link preview names the owner and the wish count, and
// nothing else. It reads only getSharePreview, never the list itself.
const getSharePreview = vi.fn();
const getSharedList = vi.fn();
vi.mock("@/modules/lists", () => ({ getSharePreview, getSharedList }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
const genericCard = vi.fn(async () => "generic-card");
vi.mock("@/app/opengraph-image", () => ({ default: genericCard }));
const ImageResponse = vi.fn(function (this: { element: unknown }, element: unknown) {
  this.element = element;
});
vi.mock("next/og", () => ({ ImageResponse }));
const holidayLogoNow = vi.fn(async () => false);
vi.mock("@/lib/holiday", () => ({ holidayLogoNow }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/concierge", () => ({ getPerson: vi.fn(), listPeople: vi.fn() }));
vi.mock("@/lib/today", () => ({ todayForRequest: vi.fn() }));
vi.mock("../actions", () => ({ linkFromShareAction: vi.fn(), unlinkFromShareAction: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from("")) }));

const TOKEN = "11111111-1111-4111-8111-111111111111";
const params = Promise.resolve({ token: TOKEN });

// All the text a rendered element tree would show.
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = (node as { props?: { children?: unknown } }).props;
  return textOf(props?.children);
}

beforeEach(() => vi.clearAllMocks());

describe("share page metadata", () => {
  it("titles the preview with the owner's name and keeps the page out of search", async () => {
    getSharePreview.mockResolvedValue({ ownerName: "Sam Lee", itemCount: 5 });
    const { generateMetadata } = await import("../page");
    const meta = await generateMetadata({ params } as never);
    expect(meta.title).toBe("Sam Lee's wish list on GiftsAF");
    expect(meta.openGraph?.title).toBe("Sam Lee's wish list on GiftsAF");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it.each([
    ["an unknown or reset token", null],
    ["no owner name or the setting off", { ownerName: null, itemCount: 5 }],
  ])("gives the generic title for %s", async (_label, preview) => {
    getSharePreview.mockResolvedValue(preview);
    const { generateMetadata } = await import("../page");
    const meta = await generateMetadata({ params } as never);
    expect(meta.title).toBe("GiftsAF");
    expect(JSON.stringify(meta)).not.toMatch(/wish list/);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(getSharedList).not.toHaveBeenCalled();
  });
});

describe("share link image", () => {
  it("shows the name and the wish count, from getSharePreview only", async () => {
    getSharePreview.mockResolvedValue({ ownerName: "Sam Lee", itemCount: 5 });
    const { default: Image } = await import("../opengraph-image");
    await Image({ params });
    const text = textOf(ImageResponse.mock.calls[0]![0]);
    expect(text).toContain("Sam Lee");
    expect(text).toContain("5 wishes");
    expect(getSharePreview).toHaveBeenCalledWith(TOKEN);
    expect(getSharedList).not.toHaveBeenCalled();
    expect(genericCard).not.toHaveBeenCalled();
  });

  const draw = async (ownerName: string, itemCount = 5) => {
    getSharePreview.mockResolvedValue({ ownerName, itemCount });
    const { default: Image } = await import("../opengraph-image");
    await Image({ params });
    return ImageResponse.mock.calls[0]![0];
  };

  it("reads as the owner's wish list", async () => {
    expect(textOf(await draw("Sam Lee"))).toContain("Sam Lee’swish list5 wishes");
  });

  it.each([
    [false, false],
    [true, true],
  ])("draws the yellow tag, with the hat only in season (%s)", async (holiday, hat) => {
    holidayLogoNow.mockResolvedValueOnce(holiday);
    const drawn = JSON.stringify(await draw("Sam Lee"));
    expect(drawn).toContain(encodeURIComponent("#facc15"));
    expect(drawn.includes(encodeURIComponent("rotate(14 32 26)"))).toBe(hat);
  });

  it("doesn't say '0 wishes' for an empty list", async () => {
    const text = textOf(await draw("Sam Lee", 0));
    expect(text).toContain("No wishes yet");
    expect(text).not.toContain("0 wishes");
  });

  // One code point, a family joined from five, and a letter with a separate accent.
  it.each(["🎁", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "e\u0301"])(
    "cuts a very long name, never through a character, and keeps it a possessive (%s)",
    async (char) => {
      const text = textOf(await draw(char.repeat(40)));
      expect(text).toContain(`${char.repeat(31)}…’s`);
      expect(text).toContain("wish list");
    },
  );

  it("says '1 wish' for one", async () => {
    getSharePreview.mockResolvedValue({ ownerName: "Sam Lee", itemCount: 1 });
    const { default: Image } = await import("../opengraph-image");
    await Image({ params });
    expect(textOf(ImageResponse.mock.calls[0]![0])).toContain("1 wish");
    expect(textOf(ImageResponse.mock.calls[0]![0])).not.toContain("1 wishes");
  });

  it.each([
    ["an unknown or reset token", null],
    ["no owner name or the setting off", { ownerName: null, itemCount: 5 }],
  ])("draws the generic card for %s", async (_label, preview) => {
    getSharePreview.mockResolvedValue(preview);
    const { default: Image } = await import("../opengraph-image");
    expect(await Image({ params })).toBe("generic-card");
    expect(ImageResponse).not.toHaveBeenCalled();
    expect(getSharedList).not.toHaveBeenCalled();
  });
});
