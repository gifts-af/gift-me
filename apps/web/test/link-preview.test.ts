// @vitest-environment node
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { siteUrl } from "@/lib/site-url";
import { tagSvg } from "@/lib/logo-art";

// ALL-55: link previews (LinkedIn, iMessage, Slack…) need Open Graph tags and
// absolute image URLs on the real domain.
describe("siteUrl", () => {
  it("uses the production domain in production, not the per-deploy URL", () => {
    expect(
      siteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "giftsaf.com", VERCEL_URL: "gift-me-abc.vercel.app" }),
    ).toBe("https://giftsaf.com");
  });

  it("uses the deploy's own URL for previews", () => {
    expect(siteUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "giftsaf.com", VERCEL_URL: "gift-me-abc.vercel.app" })).toBe(
      "https://gift-me-abc.vercel.app",
    );
  });

  it("falls back to localhost when running locally", () => {
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("share tags", () => {
  it("describes the site for link previews", () => {
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "GiftsAF",
      title: "GiftsAF · Gifting, handled AF.",
      description: "We remember the dates, find the gift, and ship it. You just tap yes.",
    });
  });

  it("leaves og:url to each page, so a shared list's card opens that list", () => {
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("asks for a large image card on X and others", () => {
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("share image art", () => {
  it("is the logo's tag, with the hat only in the holiday season", () => {
    expect(tagSvg({ holiday: false })).toContain('data-part="tag"');
    expect(tagSvg({ holiday: false })).not.toContain('data-part="hat"');
    expect(tagSvg({ holiday: true })).toContain('data-part="hat"');
  });
});
