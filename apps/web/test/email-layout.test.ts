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
});
