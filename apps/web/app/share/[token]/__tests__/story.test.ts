import { beforeEach, describe, expect, it, vi } from "vitest";

// The Story card: a 1080×1920 PNG from getSharePreview only, generic when there's no name.
const getSharePreview = vi.fn();
const getSharedList = vi.fn();
vi.mock("@/modules/lists", () => ({ getSharePreview, getSharedList }));
const ImageResponse = vi.fn(function (this: { element: unknown; options: unknown }, element: unknown, options: unknown) {
  this.element = element;
  this.options = options;
});
vi.mock("next/og", () => ({ ImageResponse }));
vi.mock("@/lib/holiday", () => ({ holidayLogoNow: vi.fn(async () => false) }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from("")) }));

const TOKEN = "11111111-1111-4111-8111-111111111111";

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf((node as { props?: { children?: unknown } }).props?.children);
}

type Options = { width: number; height: number; headers: Record<string, string> };

async function draw() {
  const { GET } = await import("../story/route");
  await GET(new Request("http://localhost/share/t/story"), { params: Promise.resolve({ token: TOKEN }) });
  const [element, options] = ImageResponse.mock.calls[0]! as [unknown, Options];
  return { text: textOf(element), options };
}

beforeEach(() => vi.clearAllMocks());

describe("share story image", () => {
  it("is a 1080×1920 Story with the owner's wish list and count, never cached or indexed", async () => {
    getSharePreview.mockResolvedValue({ ownerName: "Sam Lee", itemCount: 5 });
    const { text, options } = await draw();
    expect(options).toMatchObject({ width: 1080, height: 1920 });
    expect(options.headers).toMatchObject({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    expect(text).toContain("Sam Lee’swish list5 wishes");
    expect(text).toContain("giftsaf.com");
    expect(getSharePreview).toHaveBeenCalledWith(TOKEN);
    expect(getSharedList).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown or reset token", null],
    ["no owner name or the setting off", { ownerName: null, itemCount: 5 }],
  ])("draws a generic tall card for %s", async (_label, preview) => {
    getSharePreview.mockResolvedValue(preview);
    const { text, options } = await draw();
    expect(options).toMatchObject({ width: 1080, height: 1920 });
    expect(text).not.toMatch(/wish list|wishes/);
    expect(text).toContain("giftsaf.com");
  });
});
