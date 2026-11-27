import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeeSheet, RoundPageIdea } from "@/modules/concierge";
import { ConfirmScreen, type BuyResult, type ConfirmCard, type ConfirmScreenProps } from "../[id]/buy/confirm-screen";
import type { StartCardResult } from "../card-ui";

// The confirm page for a card buyer (ALL-98 mock-ups 1a to 1d and 2). The mock-ups' example: a
// $22.59 mouse pad, the $2.00 fixed fee and a 10% cap, so $25.64 at today's price and $27.97 at
// most. The server actions are faked; the real ones run in e2e/card-payments.spec.ts, and
// approveAndBuy's shownMaxCents check in approval-db.test.ts.

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

function setup(card: Partial<ConfirmCard> = {}, result: BuyResult = { ok: true, status: "ordered", reason: null }, start: StartCardResult = { ok: true, url: "https://checkout.stripe.test/c/cs_1" }) {
  const buyAction = vi.fn(async (...a: [string, FormData]): Promise<BuyResult> => (void a, result));
  const startCard = vi.fn(async (phone: string | null): Promise<StartCardResult> => (void phone, start));
  const props: ConfirmScreenProps = {
    roundId: "r1",
    personId: "p1",
    personName: "Jimmy",
    ideas: [idea()],
    blocked: null,
    budgetCents: 3000,
    overBudgetPct: 10,
    feeCents: 100,
    neverMoreThanCents: 2797,
    giftMessageMax: 240,
    balanceCents: null,
    recipient: { kind: "own", city: "Austin", state: "TX" },
    buyerAddress: null,
    returnPath: "/rounds/r1/buy?ideas=i1",
    buyAction,
    card: { on: true, hasCard: true, needsPhone: false, fee: FEE, capGoodsCents: 2485, cardReturn: null, startCard, ...card },
  };
  render(<ConfirmScreen {...props} />);
  return { buyAction, startCard };
}

describe("ConfirmScreen for a card buyer", () => {
  it("AC-4, AC-5: the gift, one GiftsAF fee line, the estimate and Most you'll pay; no Zinc anywhere", () => {
    setup();
    const lines = screen.getByRole("list", { name: "What it costs" });
    expect(within(lines).getByText("Price, shipping and tax").nextSibling).toHaveTextContent("$22.59");
    expect(within(lines).getByText("GiftsAF fee").closest("li")).toHaveTextContent("$3.05");
    expect(within(lines).getByText("About $25.64")).toBeInTheDocument();
    expect(within(lines).getByText("Most you'll pay").nextSibling).toHaveTextContent("$27.97");
    // The idea's own price is the goods alone.
    expect(screen.getAllByText("$22.59").length).toBeGreaterThanOrEqual(2);
    expect(document.body).not.toHaveTextContent(/Zinc|balance|Never more than/);
  });

  it("1b: a saved card, the card money notice and Buy now, which sends the Most you'll pay shown", async () => {
    const { buyAction } = setup();
    expect(screen.getByText("Saved card")).toBeInTheDocument();
    expect(screen.getByText("Charged only when you tap Buy now.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Each gift costs its price plus the GiftsAF fee, charged to your card.");
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $25.64" }));
    expect(buyAction.mock.calls[0][1].get("shownMaxCents")).toBe("2797");
    expect(await screen.findByText("Ordered")).toBeInTheDocument();
  });

  it("AC-1, AC-17 (1a): no card and no phone asks for the phone next to Add a card, and there's no Buy now", async () => {
    const { startCard, buyAction } = setup({ hasCard: false, needsPhone: true });
    expect(screen.queryByRole("button", { name: /Buy now/ })).toBeNull();
    expect(screen.getByText(/Nothing is bought until you tap Buy now\./)).toBeInTheDocument();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    try {
      await userEvent.type(screen.getByLabelText("Your phone"), "(555) 123-4567");
      await userEvent.click(screen.getByRole("button", { name: "Add a card" }));
      expect(startCard).toHaveBeenCalledWith("(555) 123-4567");
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/c/cs_1"));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(buyAction).not.toHaveBeenCalled();
  });

  it("AC-17: a refused phone says what to fix and stays on the page", async () => {
    setup({ hasCard: false, needsPhone: true }, undefined, { ok: false, error: "bad_phone" });
    await userEvent.click(screen.getByRole("button", { name: "Add a card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a 10-digit phone number.");
  });

  it("a phone already saved isn't asked again", () => {
    setup({ hasCard: false, needsPhone: false });
    expect(screen.queryByLabelText("Your phone")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
  });

  it("Change on the saved card opens Stripe's page again, with no phone", async () => {
    const { startCard } = setup();
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    try {
      await userEvent.click(screen.getByRole("button", { name: "Change card" }));
      expect(startCard).toHaveBeenCalledWith(null);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AC-12 (1c): paused shows Buying is paused, with no Add a card, no Buy now and no ship-to", () => {
    setup({ on: false, hasCard: false });
    expect(screen.getByRole("status")).toHaveTextContent("Buying is pausedWe can't buy gifts right now. Nothing was bought. We'll email you when it's back on.");
    expect(screen.queryByRole("button", { name: /Add a card|Buy/ })).toBeNull();
    expect(screen.queryByText("Ships to")).toBeNull();
    expect(screen.getByRole("link", { name: "See the other ideas" })).toHaveAttribute("href", "/rounds/r1");
  });

  it("back from Stripe after cancelling says no card was saved", () => {
    setup({ hasCard: false, cardReturn: "cancelled" });
    expect(screen.getByText("No card was saved. Nothing was bought.")).toBeInTheDocument();
  });

  it("AC-4: a higher Most you'll pay from the server buys nothing, shows the new figure and asks again", async () => {
    const { buyAction } = setup({}, { ok: false, error: "price_changed", neverMoreThanCents: 2850 });
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $25.64" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The most you'll pay is now $28.50. Nothing was bought.");
    expect(screen.getByText("Most you'll pay").nextSibling).toHaveTextContent("$28.50");
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $25.64" }));
    expect(buyAction.mock.calls[1][1].get("shownMaxCents")).toBe("2850");
  });

  it("AC-4 (2a, 2b): the (i) breakdown lists each part, launch pricing and what the cap allows", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "What's in the GiftsAF fee" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Launch pricing: at cost")).toBeInTheDocument();
    const row = (name: string) => within(sheet).getByText(name).closest("tr")!;
    expect(row("Ordering")).toHaveTextContent("$1.00");
    expect(row("AI suggestions")).toHaveTextContent("$0.65");
    expect(row("Running GiftsAF")).toHaveTextContent("$0.35");
    expect(row("Card fee")).toHaveTextContent("what the card company charges: 2.9% + 30¢ of $25.64$1.05");
    expect(sheet).toHaveTextContent("If the price goes up (up to $24.85), the card fee goes up with it, to at most $1.12. So the most you'll pay is $27.97.");
    expect(sheet).toHaveTextContent("We don't make money on the fee yet.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
