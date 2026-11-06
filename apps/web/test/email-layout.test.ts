// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMAIL_LOGO_URL, renderEmail } from "@/lib/email-layout";

// ALL-71: every email carries the GiftsAF wordmark, and the button is optional.
describe("renderEmail", () => {
  it("every email starts with the GiftsAF logo", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["x"] });
    expect(EMAIL_LOGO_URL).toBe("https://giftsaf.com/email-logo.png");
    const img = html.match(/<img [^>]*>/)?.[0] ?? "";
    expect(img).toContain(`src="${EMAIL_LOGO_URL}"`);
    expect(img).toContain('alt="GiftsAF"');
    expect(img).toMatch(/width="\d+"/);
    expect(img).toMatch(/height="\d+"/);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<h1"));
  });

  it("the button is optional", () => {
    const { html, text } = renderEmail({ heading: "Hi", paragraphs: ["x"] });
    expect(html).not.toContain("<a ");
    expect(text).not.toMatch(/: https?:/);
  });

  it("with a button, it's still 48px tall", () => {
    const { html, text } = renderEmail({ heading: "Hi", paragraphs: ["x"], button: { label: "Go", url: "https://giftsaf.com/a/x" } });
    expect(html).toContain("line-height:20px;padding:14px 20px");
    expect(text).toContain("Go: https://giftsaf.com/a/x");
  });

  // ALL-32 (owner): balanced headings and no lone last word, inline styles only.
  it("balances the heading and avoids a lone last word in paragraphs", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["x"], footer: "f" });
    expect(html.match(/<h1 [^>]*>/)?.[0]).toContain("text-wrap:balance");
    for (const p of html.match(/<p style="margin:0 0 16px;font-size[^>]*>/g) ?? []) expect(p).toContain("text-wrap:pretty");
    expect(html).not.toContain("<style");
  });

  it("shows a warning box before the button and a note after it", () => {
    const { html, text } = renderEmail({
      heading: "Hi",
      paragraphs: ["x"],
      warning: { lead: "Your Zinc balance is low.", text: "Add funds." },
      button: { label: "Go", url: "https://giftsaf.com/a/x" },
      note: "Alpha: a note.",
    });
    expect(html.indexOf("Your Zinc balance is low.")).toBeLessThan(html.indexOf("https://giftsaf.com/a/x"));
    expect(html.indexOf("Alpha: a note.")).toBeGreaterThan(html.indexOf("https://giftsaf.com/a/x"));
    expect(html).toContain("<strong");
    expect(text).toContain("Your Zinc balance is low. Add funds.");
    expect(text).toContain("Alpha: a note.");
  });

  it("puts plain links in order, with words before one, each tall enough to tap", () => {
    const { html, text } = renderEmail({
      heading: "Hi",
      paragraphs: ["x"],
      link: [
        { label: "Top up", url: "https://zinc.test/wallet" },
        { before: "Changed your mind?", label: "Cancel this gift", url: "https://giftsaf.com/a/c" },
      ],
    });
    expect(html.indexOf("Top up")).toBeLessThan(html.indexOf("Cancel this gift"));
    expect(html).toContain("Changed your mind? <a");
    expect(html.match(/padding:12px 0/g)).toHaveLength(2);
    expect(text).toContain("Changed your mind? Cancel this gift: https://giftsaf.com/a/c");
  });
});
