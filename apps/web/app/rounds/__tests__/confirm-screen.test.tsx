import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoundPageIdea } from "@/modules/concierge";
import { ConfirmScreen, type BuyResult, type ConfirmScreenProps } from "../[id]/buy/confirm-screen";

// The confirm page (ALL-29 Task 12). The server action is faked here; the real one runs in the
// round journeys (Task 13) against local Supabase, and approveAndBuy in purchase.test.ts.

let n = 0;
function idea(o: Partial<RoundPageIdea> = {}): RoundPageIdea {
  n += 1;
  return {
    id: `i${n}`,
    title: `Idea ${n}`,
    reason: null,
    retailer: "amazon",
    productUrl: `https://www.amazon.com/dp/B0${n}`,
    imageUrl: null,
    source: "generated",
    listItemId: null,
    priceCents: 5000,
    totalCents: 5420,
    overBudget: false,
    rank: n,
    status: "proposed",
    arriveBy: "2026-12-12",
    claimed: false,
    claimedByMe: false,
    noLongerShared: false,
    livePrice: true,
    ...o,
  };
}

function setup(o: Partial<ConfirmScreenProps> = {}, result: BuyResult = { ok: true, status: "ordered", reason: null }) {
  const buyAction = vi.fn(async (...a: [string, FormData]): Promise<BuyResult> => (void a, result));
  const props: ConfirmScreenProps = {
    roundId: "r1",
    personId: "p1",
    personName: "Mom",
    ideas: [idea({ title: "LEGO Botanical Orchid" })],
    blocked: null,
    budgetCents: 5500,
    overBudgetPct: 10,
    feeCents: 100,
    neverMoreThanCents: 5600,
    giftMessageMax: 240,
    balanceCents: 12040,
    recipient: { kind: "shared", city: "Portland", state: "OR" },
    buyerAddress: { city: "Columbus", state: "OH" },
    returnPath: "/rounds/r1/buy?ideas=i1",
    buyAction,
    ...o,
  };
  render(<ConfirmScreen {...props} />);
  return { buyAction };
}

describe("ConfirmScreen", () => {
  it("the confirm page shows the fee, the total, never more than and the money notice", () => {
    setup();
    expect(screen.getByText("LEGO Botanical Orchid")).toBeInTheDocument();
    expect(screen.getByText(/Amazon · Arrives by/)).toBeInTheDocument();
    const lines = screen.getByRole("list", { name: "What it costs" });
    expect(within(lines).getByText("Price, shipping and tax")).toBeInTheDocument();
    expect(within(lines).getByText("$53.20")).toBeInTheDocument();
    expect(within(lines).getByText("Zinc's order fee")).toBeInTheDocument();
    expect(within(lines).getByText("$1")).toBeInTheDocument();
    expect(within(lines).getByText("About $54.20")).toBeInTheDocument();
    expect(within(lines).getByText("Never more than")).toBeInTheDocument();
    expect(within(lines).getByText("$56")).toBeInTheDocument();
    expect(screen.getByText("Each gift costs its price plus Zinc's $1 order fee, taken from your Zinc balance.")).toBeInTheDocument();
    expect(screen.getByText(/Your Zinc balance: \$120\.40/)).toBeInTheDocument();
    expect(screen.getByText("Mom · Portland, OR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy now · about $54.20" })).toBeInTheDocument();
  });

  it("a list gift priced from the list says so (AC-27)", () => {
    setup({ ideas: [idea({ title: "Camp mug", source: "list", listItemId: "li1", livePrice: false, productUrl: "https://www.rei.com/product/1" })] });
    expect(screen.getByText(/Price from their list/)).toBeInTheDocument();
  });

  it("an over-budget link reads Buy anyway and says how far over", async () => {
    const { buyAction } = setup({ budgetCents: 5000 });
    expect(screen.getByText("$4.20 over Mom's $50 budget.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy anyway · $54.20" }));
    const form = buyAction.mock.calls[0][1];
    expect(form.get("over")).toBe("1");
    expect(form.get("ideas")).toBe("i" + n);
  });

  it("within the budget the form never says it's over", async () => {
    const { buyAction } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    expect(buyAction.mock.calls[0][1].get("over")).toBeNull();
    expect(await screen.findByText("Ordered")).toBeInTheDocument();
  });

  it("past the most allowed there's no button", () => {
    setup({ budgetCents: 4000, neverMoreThanCents: null });
    expect(screen.getByText("Over the most you allowed ($44)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull();
  });

  it("the gift note stops at the setting's length", async () => {
    setup({ giftMessageMax: 10 });
    await userEvent.click(screen.getByRole("button", { name: /Gift note/ }));
    const note = screen.getByRole("textbox", { name: /Gift note/ });
    await userEvent.type(note, "Happy birthday, Mom!");
    expect((note as HTMLTextAreaElement).value).toBe("Happy birt");
  });

  it('a replaced idea shows "These ideas were replaced" and no button', () => {
    setup({ blocked: "These ideas were replaced" });
    expect(screen.getByText("These ideas were replaced")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy/ })).toBeNull();
    expect(screen.getByRole("link", { name: "See all ideas" })).toHaveAttribute("href", "/rounds/r1");
  });

  it("a server refusal says what happened in words", async () => {
    setup({}, { ok: false, error: "claimed" });
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    expect(await screen.findByText("Someone else got it")).toBeInTheDocument();
  });

  it("a second tab after the buy says it was ordered already, not replaced", async () => {
    setup({}, { ok: false, error: "already_ordered" });
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    expect(await screen.findByText("Already ordered")).toBeInTheDocument();
    expect(screen.getByText("This gift was ordered already. Nothing more was bought.")).toBeInTheDocument();
    expect(screen.queryByText("These ideas were replaced")).toBeNull();
  });

  it("a hold on the balance says so", async () => {
    setup({}, { ok: true, status: "held", reason: "funds" });
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    expect(await screen.findByText("Waiting on your Zinc balance")).toBeInTheDocument();
  });

  it("no address links to the person's address form and back here", async () => {
    setup({ recipient: { kind: "none" } }, { ok: false, error: "no_address" });
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    const link = await screen.findByRole("link", { name: "Add Mom's address" });
    expect(link).toHaveAttribute("href", `/people/p1/address?open=1&next=${encodeURIComponent("/rounds/r1/buy?ideas=i1")}`);
  });

  it("ships to me when chosen", async () => {
    const { buyAction } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Ships to/ }));
    await userEvent.click(screen.getByRole("radio", { name: /My address/ }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("You · Columbus, OH")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy now · about $54.20" }));
    expect(buyAction.mock.calls[0][1].get("shipTo")).toBe("buyer");
  });
});
