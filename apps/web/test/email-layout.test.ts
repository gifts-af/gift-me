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

describe("renderEmail rows with a link (ALL-29)", () => {
  const parts = {
    heading: "Hi",
    paragraphs: ["x"],
    rows: [
      { title: "Mug · $42", detail: "Arrives by Dec 12 · Amazon", reason: "Loves tea.", link: { label: "Buy this ›", url: "https://giftsaf.com/rounds/r1/buy?ideas=i1" } },
      { title: "Plain · $10" },
    ],
  };

  it("a row with a link renders it as an anchor and in the text version", () => {
    const { html, text } = renderEmail(parts);
    expect(html).toContain('<a href="https://giftsaf.com/rounds/r1/buy?ideas=i1"');
    expect(html).toContain("Buy this ›");
    expect(html.match(/<a[\s>]/g)).toHaveLength(1);
    // 44px tall like the other plain links: 20px line plus 12px above and below.
    expect(html).toMatch(/<a href="https:\/\/giftsaf\.com\/rounds\/r1\/buy\?ideas=i1"[^>]*line-height:20px;padding:12px 0/);
    // The reason is in italics, under the detail and above the link.
    expect(html).toMatch(/font-style:italic[^>]*>Loves tea\./);
    expect(html.indexOf("Loves tea.")).toBeLessThan(html.indexOf("Buy this"));
    expect(text).toContain("- Mug · $42 (Arrives by Dec 12 · Amazon)");
    expect(text).toContain("Loves tea.");
    expect(text).toContain("Buy this ›: https://giftsaf.com/rounds/r1/buy?ideas=i1");
    expect(text).toContain("- Plain · $10\n");
  });

  it("escapes a row's reason", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["x"], rows: [{ title: "T", reason: "<b>&" }] });
    expect(html).toContain("&lt;b&gt;&amp;");
  });
});
