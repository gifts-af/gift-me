import { describe, expect, it, vi } from "vitest";
import { readGiftLink } from "../gift-link";

// Reading a pasted gift link for other modules (ALL-93). Store pages aren't
// ours, so the page read is faked (E5); the link parsing is the real thing.

const REEL = "https://www.amazon.com/Fly-Reel/dp/B0TESTREEL";
const MUG = "https://www.example-store.com/products/blue-mug";

describe("readGiftLink", () => {
  it("reads an Amazon link from the link itself, with no page read", async () => {
    const readPage = vi.fn();
    const read = await readGiftLink(REEL, readPage);
    expect(read).toMatchObject({ ok: true, productUrl: "https://www.amazon.com/dp/B0TESTREEL", priceCents: null });
    if (!read.ok) throw new Error("expected ok");
    expect(read.name).toMatch(/reel/i);
    expect(read.imageUrl).toMatch(/^https:\/\//);
    expect(readPage).not.toHaveBeenCalled();
  });

  it("takes name, price and photo from a store page that could be read", async () => {
    const readPage = vi.fn(async () => ({
      ok: true as const,
      product: { name: "Mug", priceCents: 1200, imageUrl: "https://x.example/i.jpg" },
    }));
    const read = await readGiftLink(MUG, readPage);
    expect(read).toMatchObject({ ok: true, name: "Mug", priceCents: 1200, imageUrl: "https://x.example/i.jpg" });
    expect(readPage).toHaveBeenCalledWith("https://www.example-store.com/products/blue-mug");
  });

  it("only lets the page's non-null fields replace what the link gave", async () => {
    const readPage = vi.fn(async () => ({ ok: true as const, product: { name: null, priceCents: 900, imageUrl: null } }));
    const read = await readGiftLink(MUG, readPage);
    expect(read).toMatchObject({ ok: true, name: "Blue Mug", priceCents: 900, imageUrl: null });
  });

  it("keeps the link's own reading when the page is blocked or the read throws", async () => {
    const blocked = await readGiftLink(MUG, async () => ({ ok: false, reason: "blocked_address" }));
    expect(blocked).toMatchObject({ ok: true, name: "Blue Mug", priceCents: null });
    const thrown = await readGiftLink(MUG, async () => {
      throw new Error("network");
    });
    expect(thrown).toMatchObject({ ok: true, name: "Blue Mug", priceCents: null });
  });

  it("cuts a long page name to 200 characters and drops an over-long photo link", async () => {
    const read = await readGiftLink(MUG, async () => ({
      ok: true,
      product: { name: "n".repeat(300), priceCents: 100, imageUrl: `https://x.example/${"i".repeat(2100)}` },
    }));
    if (!read.ok) throw new Error("expected ok");
    expect(read.name).toHaveLength(200);
    expect(read.imageUrl).toBeNull();
  });

  it("only cleans the link when no page read is given", async () => {
    const read = await readGiftLink("https://www.amazon.com/x/dp/B0TESTREEL?ref=abc&tag=zz", null);
    expect(read).toMatchObject({ ok: true, productUrl: "https://www.amazon.com/dp/B0TESTREEL" });
  });

  it("explains a link it can't use", async () => {
    const read = await readGiftLink("not a link", null);
    expect(read).toEqual({ ok: false, error: "That doesn't look like a web address. Check the link and try again." });
  });
});
