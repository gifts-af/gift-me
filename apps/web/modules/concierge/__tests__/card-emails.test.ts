// What a card buyer's emails say (design/mockups/ALL-98-card-payments.html part 6): the gift, the
// GiftsAF fee and the total where money moved, a pending hold that drops off when nothing was
// bought, and never a Zinc balance. A wallet buyer's are pinned by wallet-emails-unchanged.test.ts.
import { describe, expect, it } from "vitest";
import { TEMPLATES, type RenderedEmail } from "../notify/templates";

const OCC = { personName: "Jimmy", occasion: "birthday", dateText: "March 12" };
const OPEN = { open: "https://giftsaf.test/fix" };
const ZINC = /zinc|balance|wallet/i;
const HOLD = "If you see a pending hold on your card, it will drop off.";
const said = (m: RenderedEmail) => `${m.subject}\n${m.text}`;

describe("ordered by card (6a)", () => {
  const m = TEMPLATES.ordered(
    { ...OCC, giftTitle: "Mouse pad", cityText: "Austin, TX", charge: { goodsText: "$22.59", feeText: "$3.05", totalText: "$25.64" } },
    { open: "https://giftsaf.test/r" },
  );
  it("AC-20: shows the gift, the GiftsAF fee and what the card was charged", () => {
    expect(m.subject).toBe("Jimmy's gift is ordered");
    expect(m.text).toContain("We ordered the Mouse pad for Jimmy's birthday on March 12. It's on its way to Austin, TX.");
    expect(m.text).toContain("Mouse pad");
    expect(m.text).toContain("$22.59 · price, shipping and tax");
    expect(m.text).toContain("GiftsAF fee");
    expect(m.text).toContain("$3.05");
    expect(m.text).toContain("Charged to your card: $25.64");
    expect(said(m)).not.toMatch(ZINC);
  });
});

describe("failed on a card order (6b)", () => {
  it("AC-8: the closed-round email says nothing was charged and a pending hold drops off", () => {
    const m = TEMPLATES.failed_late({ ...OCC, card: true, failed: [{ title: "Mouse pad" }] }, OPEN);
    expect(m.text).toContain("The store couldn't place the order. You haven't been charged for it.");
    expect(m.text).toContain(HOLD);
    expect(said(m)).not.toMatch(ZINC);
  });
  it.each(["price_up", "out_of_stock", "too_late"] as const)("AC-8: %s says a pending hold drops off", (kind) => {
    const m = TEMPLATES[kind]({ ...OCC, giftTitle: "Mouse pad", orderByText: "March 5", card: true }, OPEN);
    expect(m.text).toContain(HOLD);
    expect(said(m)).not.toMatch(ZINC);
  });
  it("AC-8: the open-round failure and the summary say it too", () => {
    const one = TEMPLATES.needs_attention({ ...OCC, card: true, reason: "the store couldn't place the order for the Mouse pad, and you haven't been charged for it.", orderByText: "March 5" }, OPEN);
    expect(one.text).toContain(HOLD);
    const two = TEMPLATES.failed_several(
      { ...OCC, card: true, pendingHold: true, tried: 2, orderByText: "March 5", failed: [{ title: "A", detail: "x", url: "u" }, { title: "B", detail: "y", url: "u" }] },
      OPEN,
    );
    expect(two.text).toContain(HOLD);
    expect(said(two)).not.toMatch(ZINC);
  });
});

describe("card needed (6d, 6e)", () => {
  it("AC-6: with no card saved, add a card and tap Buy again", () => {
    const m = TEMPLATES.needs_attention({ ...OCC, reason: "", orderByText: "March 5", cardNeeded: { saved: false } }, OPEN);
    expect(m.subject).toBe("Sorry, we couldn't buy Jimmy's gift yet");
    expect(m.text).toContain("Your card changed or couldn't be charged. Nothing was bought.");
    expect(m.text).toContain("Add a card and tap Buy again.");
    expect(m.html).toContain(">Add a card</a>");
    expect(m.text).toContain("What happens next: we won't try again on our own. Nothing is bought until you tap Buy again.");
    expect(said(m)).not.toMatch(/store couldn't place/);
    expect(said(m)).not.toMatch(ZINC);
  });
  it("AC-6: with a card saved, tap Buy again", () => {
    const m = TEMPLATES.needs_attention({ ...OCC, reason: "", orderByText: "March 5", cardNeeded: { saved: true } }, OPEN);
    expect(m.text).toContain("Tap Buy again.");
    expect(m.text).not.toContain("Add a card");
    expect(m.html).toContain(">Review and buy again</a>");
  });
});

describe("store cancelled a card order (6c)", () => {
  it("AC-9: the whole charge is refunded to the card, fee included", () => {
    const m = TEMPLATES.store_cancelled_late({ ...OCC, gifts: [{ title: "Mouse pad", store: "Amazon", card: { totalText: "$25.64" } }] }, {});
    expect(m.subject).toBe("Sorry, the store cancelled Jimmy's gift");
    expect(m.text).toContain("We're sorry. Amazon cancelled the Mouse pad for Jimmy's birthday on March 12.");
    expect(m.text).toContain("The whole charge, $25.64, is refunded to your card, fee included. It can take 5 to 10 days to show.");
    expect(said(m)).not.toMatch(ZINC);
  });
  it("AC-9: without Zinc's figure it still says the whole charge, never an amount we guessed", () => {
    const m = TEMPLATES.store_cancelled_late({ ...OCC, gifts: [{ title: "A", card: {} }, { title: "B", card: {} }] }, {});
    expect(m.text).toContain("The whole charge is refunded to your card, fee included.");
    expect(said(m)).not.toMatch(ZINC);
  });
  it("AC-9: the summary and the daily news say so too", () => {
    const sum = TEMPLATES.failed_several(
      { ...OCC, card: true, tried: 2, orderByText: "March 5", failed: [{ title: "A", detail: "x", url: "u", refunded: true }, { title: "B", detail: "y", url: "u", refunded: true }] },
      OPEN,
    );
    expect(sum.text).toContain("The whole charge for them is refunded to your card, fee included.");
    expect(said(sum)).not.toMatch(ZINC);
    const news = TEMPLATES.tracking_news(
      { items: [{ kind: "cancelled", ...OCC, title: "Mouse pad", card: { totalText: "$25.64" } }, { kind: "on_time", ...OCC, title: "Mug", expectedText: "March 10" }] },
      {},
    );
    expect(news.text).toContain("The whole charge, $25.64, is refunded to your card, fee included.");
    expect(said(news)).not.toMatch(ZINC);
  });
});

describe("held card orders", () => {
  it.each(["hold_setup", "hold_address", "hold_trouble"] as const)("AC-20: %s never mentions Zinc", (kind) => {
    const links = { setup: "s", addAddress: "a", open: "o", cancel: "c" };
    const m = TEMPLATES[kind]({ ...OCC, giftTitles: ["Mouse pad"], feeText: "$1", card: true }, links);
    expect(said(m)).not.toMatch(ZINC);
    expect(m.text).toContain("its price plus the GiftsAF fee");
  });

  it("hold_setup: for a card buyer only the phone is missing, so it asks for that and never says payment isn't set up", () => {
    const links = { setup: "s", cancel: "c" };
    const m = TEMPLATES.hold_setup({ ...OCC, giftTitles: ["Mouse pad"], feeText: "$1", card: true }, links);
    expect(m.subject).toBe("Add your phone number to buy Jimmy's gift");
    expect(m.text).toContain("Stores need a phone number for delivery. Add yours and we'll buy it.");
    expect(said(m)).not.toMatch(/payment|set up|setup/i);
  });
});
