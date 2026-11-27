import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeeSheet, RoundPageIdea, RoundPageOrder } from "@/modules/concierge";
import { FixScreen, type CheckResult, type FixCard, type FixResult, type FixScreenProps } from "../[id]/fix/[orderId]/fix-screen";
import type { StartCardResult } from "../card-ui";

// The fix page for a card that couldn't be charged (ALL-98 mock-ups 3a to 3c), and a card
// buyer's other fixes. Actions are faked; the real ones run in e2e/card-payments.spec.ts and
// replaceFailedOrder's card path in replace.test.ts.

// WaysOut refreshes the page after a skip or pick.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const FEE: FeeSheet = {
  label: "GiftsAF fee",
  pricingNote: "Launch pricing: at cost",
  zincFeeCents: 100,
  aiCents: 65,
  runningCents: 35,
  cardFeeBps: 290,
  cardFeeFixedCents: 30,
};

function idea(o: Partial<RoundPageIdea> = {}): RoundPageIdea {
  return {
    id: "i1",
    title: "Mouse pad",
    reason: null,
    retailer: "amazon",
    productUrl: "https://www.amazon.com/dp/B01",
    imageUrl: null,
    source: "generated",
    listItemId: null,
    priceCents: 2000,
    totalCents: 2564,
    goodsCents: 2259,
    overBudget: false,
    rank: 1,
    status: "proposed",
    arriveBy: "2027-03-10",
    claimed: false,
    claimedByMe: false,
    noLongerShared: false,
    livePrice: true,
    ...o,
  };
}

function order(o: Partial<RoundPageOrder> = {}): RoundPageOrder {
  return {
    id: "o1",
    ideaId: "i1",
    title: "Mouse pad",
    status: "failed",
    failureType: "card_needed",
    totalCents: null,
    refundCents: null,
    maxPriceCents: 2485,
    feeCents: 312,
    estDeliveryDate: null,
    placedAt: null,
    deliveredAt: null,
    packages: [],
    handlingDaysMax: null,
    deliveryDaysMax: null,
    ...o,
  };
}

const NOTICE = "Checking today's price is a live lookup, which costs real money: about 1¢.";

function setup(card: Partial<FixCard> = {}, o: Partial<FixScreenProps> = {}, results: { check?: CheckResult; fix?: FixResult } = {}) {
  const checkPriceAction = vi.fn(async (...a: [string, string]): Promise<CheckResult> => (void a, results.check ?? { ok: true, oldCents: 2564, newCents: 2564, maxCents: 2797 }));
  const replaceAction = vi.fn(async (...a: [string, string, FormData]): Promise<FixResult> => (void a, results.fix ?? { ok: true, status: "ordered", reason: null }));
  const startCard = vi.fn(async (phone: string | null): Promise<StartCardResult> => (void phone, { ok: true, url: "https://checkout.stripe.test/c/cs_1" }));
  const props: FixScreenProps = {
    roundId: "r1",
    personId: "p1",
    personName: "Jimmy",
    shipByDeadline: "2027-03-10",
    order: order(),
    idea: idea(),
    nextBest: idea({ id: "i2", title: "Desk lamp", totalCents: 3100, goodsCents: 2800 }),
    budgetCents: 5000,
    overBudgetPct: 10,
    committedCents: 0,
    feeCents: 100,
    priceCheckNotice: NOTICE,
    recipient: { kind: "own", city: "Austin", state: "TX" },
    buyerAddress: null,
    returnPath: "/rounds/r1/fix/o1",
    checkPriceAction,
    replaceAction,
    occasionKind: "birthday",
    canPick: false,
    canSkip: false,
    pickAgainAction: vi.fn(),
    skipRoundAction: vi.fn(),
    card: { on: true, hasCard: true, needsPhone: false, fee: FEE, cardReturn: null, startCard, maxFor: { i1: 2797, i2: 3380 }, ...card },
    ...o,
  };
  render(<FixScreen {...props} />);
  return { checkPriceAction, replaceAction, startCard };
}

describe("FixScreen for a card that couldn't be charged", () => {
  it("AC-6, AC-13 (3a): no card says nothing was bought and offers Add a card, which buys nothing", async () => {
    const { startCard, replaceAction, checkPriceAction } = setup({ hasCard: false });
    expect(screen.getByText("Your card changed or couldn't be charged")).toBeInTheDocument();
    expect(screen.getByText(/^Nothing was bought\. Choose by/)).toBeInTheDocument();
    expect(screen.getByText("You approved $25.64")).toBeInTheDocument();
    expect(screen.getByText(/Then you'll come back here and tap Buy again\./)).toHaveTextContent("Adding a card doesn't buy anything.");
    expect(screen.queryByRole("button", { name: /Buy|Check today's price/ })).toBeNull();
    // No next-best gift while a card is what's missing.
    expect(screen.queryByText("Desk lamp")).toBeNull();
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    try {
      await userEvent.click(screen.getByRole("button", { name: "Add a card" }));
      expect(startCard).toHaveBeenCalledWith(null);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(replaceAction).not.toHaveBeenCalled();
    expect(checkPriceAction).not.toHaveBeenCalled();
  });

  it("AC-6 (3b): with a card saved, opening the page costs nothing; checking today's price is a tap", () => {
    const { checkPriceAction } = setup();
    expect(checkPriceAction).not.toHaveBeenCalled();
    expect(screen.getByText("Saved card")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(NOTICE);
    expect(screen.getByRole("button", { name: "Check today's price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy again/ })).toBeNull();
    expect(document.body).not.toHaveTextContent(/Zinc/);
  });

  it("AC-4, AC-6 (3c): after the check, today's price and fee, Most you'll pay, and Buy again sending it", async () => {
    const { replaceAction } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    const lines = await screen.findByRole("list", { name: "What it costs" });
    expect(within(lines).getByText("Today's price, shipping and tax").nextSibling).toHaveTextContent("$22.59");
    expect(within(lines).getByText("GiftsAF fee").closest("li")).toHaveTextContent("$3.05");
    expect(within(lines).getByText("About $25.64")).toBeInTheDocument();
    expect(within(lines).getByText("Most you'll pay").nextSibling).toHaveTextContent("$27.97");
    expect(screen.getByText("Each gift costs its price plus the GiftsAF fee, charged to your card.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy again · about $25.64" }));
    const form = replaceAction.mock.calls[0][2];
    expect(form.get("ideaId")).toBe("i1");
    expect(form.get("shownMaxCents")).toBe("2797");
  });

  it("AC-6: a gift that can't be priced today is bought at its saved estimate, still capped", async () => {
    const { replaceAction } = setup({}, {}, { check: { ok: false, error: "unavailable" } });
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    expect(await screen.findByText("Price, shipping and tax")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy again · about $25.64" }));
    expect(replaceAction.mock.calls[0][2].get("shownMaxCents")).toBe("2797");
  });

  it("AC-12: paused shows Buying is paused and nothing to add or buy", () => {
    setup({ on: false });
    expect(screen.getByText("Buying is paused")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a card|Buy|Check today's price/ })).toBeNull();
  });

  it("AC-4: a card buyer's next-best gift sends its own Most you'll pay", async () => {
    const { replaceAction } = setup({}, { order: order({ failureType: "out_of_stock" }) });
    expect(screen.getByText("Each gift costs its price plus the GiftsAF fee, charged to your card.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy this instead" }));
    expect(replaceAction.mock.calls[0][2].get("shownMaxCents")).toBe("3380");
  });

  it("back from Stripe after cancelling says no card was saved", () => {
    setup({ hasCard: false, cardReturn: "cancelled" });
    expect(screen.getByText("No card was saved. Nothing was bought.")).toBeInTheDocument();
  });
});
