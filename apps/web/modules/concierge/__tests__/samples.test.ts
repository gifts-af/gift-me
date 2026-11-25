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
      "heads_up-over_budget",
      "heads_up-restored",
      "heads_up-restored_failed",
      "reminder",
      "reminder-questions",
      "final_notice",
      "needs_attention",
      "reaction_prompt",
      "reaction_prompt-several",
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
      "out_of_stock-partial",
      "too_late",
      "missed_on_us",
      "ordered",
      "failed_late",
      "failed_late-partial",
      "failed_late-several",
      "failed_several",
      "store_cancelled_late",
      "tracking_news",
      "delivered",
      "gift_late",
      "gift_on_time",
      "check_your_address",
      "notes_tip",
      "who_is_this",
      "notes_not_read",
      "notes_cant_cancel",
      "no_ideas",
      "no_ideas-again",
      "no_ideas-spent",
      "no_ideas-too_late",
      "health-problems",
      "health-weekly-all-clear",
      "health-check-failed",
    ]);
  });

  it("points every button at the given link, so tapping a sample is harmless", () => {
    // These are answered by replying, or need nothing back, so they have no links; the all-clear lists no problem to link,
    // and a late store cancel or a too-late no-ideas email has nothing left to do in the app.
    const noLinks = ["notes_tip", "notes_not_read", "notes_cant_cancel", "health-weekly-all-clear", "store_cancelled_late", "no_ideas-too_late"];
    for (const { name, email } of samples.filter((s) => !noLinks.includes(s.name))) {
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length, name).toBeGreaterThan(0);
      expect(new Set(hrefs)).toEqual(new Set(["https://giftsaf.com/a/sample"]));
    }
  });

  it("the heads-up sample has 3 Buy this links, and the auto-buy one has none (ALL-29)", () => {
    const get = (n: string) => samples.find((s) => s.name === n)!.email;
    expect(get("heads_up-reminder").html.match(/Buy this/g)).toHaveLength(3);
    expect(get("heads_up-over_budget").html.match(/Buy this/g)).toHaveLength(3);
    expect(get("heads_up-auto_buy").html).not.toContain("Buy this");
  });

  it("the Monday health samples show the costs, and the failed check doesn't", () => {
    const get = (n: string) => samples.find((s) => s.name === n)!.email.text;
    for (const n of ["health-problems", "health-weekly-all-clear"]) expect(get(n), n).toContain("Cost per completed gift");
    expect(get("health-check-failed")).not.toContain("Cost per completed gift");
  });

  it("renders the auto-buy heads-up differently from the reminder one", () => {
    const [reminder, autoBuy] = samples.filter((s) => s.name.startsWith("heads_up"));
    expect(autoBuy.email.html).not.toEqual(reminder.email.html);
  });
});
