import { describe, expect, it } from "vitest";
import { sampleEmails } from "../notify/samples";

describe("sampleEmails", () => {
  const samples = sampleEmails("https://giftsaf.com/a/sample");

  it("has one sample per template, with heads-up in both modes", () => {
    expect(samples.map((s) => s.name)).toEqual([
      "test",
      "heads_up-reminder",
      "heads_up-auto_buy",
      "heads_up-funding",
      "reminder",
      "reminder-questions",
      "final_notice",
      "needs_attention",
      "reaction_prompt",
      "needs_address",
      "skipped",
      "skipped-held",
      "skipped-partial",
      "hold_funds",
      "hold_funds-still",
      "hold_setup",
      "hold_address",
      "hold_trouble",
      "hold_unconfirmed",
      "price_up",
      "out_of_stock",
      "too_late",
      "missed_on_us",
      "ordered",
    ]);
  });

  it("points every button at the given link, so tapping a sample is harmless", () => {
    for (const { email } of samples) {
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      expect(new Set(hrefs)).toEqual(new Set(["https://giftsaf.com/a/sample"]));
    }
  });

  it("renders the auto-buy heads-up differently from the reminder one", () => {
    const [reminder, autoBuy] = samples.filter((s) => s.name.startsWith("heads_up"));
    expect(autoBuy.email.html).not.toEqual(reminder.email.html);
  });
});
