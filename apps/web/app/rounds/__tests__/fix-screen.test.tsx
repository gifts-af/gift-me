import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zincFeeNotice } from "@gifts-af/core";
import type { RoundPageIdea, RoundPageOrder } from "@/modules/concierge";
import { FixScreen, type CheckResult, type FixResult, type FixScreenProps } from "../[id]/fix/[orderId]/fix-screen";

// The fix page (ALL-29 Task 12). The server actions are faked here; the real ones run in the
// round journeys (Task 13) against local Supabase, and the module logic in replace.test.ts.

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
    status: "selected",
    arriveBy: "2026-12-12",
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
    ideaId: "i0",
    title: "LEGO Botanical Orchid",
    status: "failed",
    failureType: "price_up",
    totalCents: null,
    maxPriceCents: 5300,
    feeCents: 100,
    estDeliveryDate: null,
    ...o,
  };
}

const NOTICE = "Checking today's price is a live lookup, which costs real money: about 1¢.";

function setup(
  o: Partial<FixScreenProps> = {},
  results: { check?: CheckResult; fix?: FixResult } = {},
) {
  const checkPriceAction = vi.fn(async (...a: [string, string]): Promise<CheckResult> => (void a, results.check ?? { ok: true, oldCents: 5420, newCents: 5840 }));
  const replaceAction = vi.fn(
    async (...a: [string, string, FormData]): Promise<FixResult> => (void a, results.fix ?? { ok: true, status: "ordered", reason: null }),
  );
  const failed = idea({ title: "LEGO Botanical Orchid" });
  const props: FixScreenProps = {
    roundId: "r1",
    personId: "p1",
    personName: "Mom",
    shipByDeadline: "2026-12-09",
    order: order({ ideaId: failed.id }),
    idea: failed,
    nextBest: idea({ title: "Le Creuset mini cocotte", totalCents: 4680, status: "proposed" }),
    budgetCents: 10000,
    overBudgetPct: 10,
    committedCents: 0,
    feeCents: 100,
    priceCheckNotice: NOTICE,
    recipient: { kind: "none" },
    buyerAddress: { city: "Columbus", state: "OH" },
    returnPath: "/rounds/r1/fix/o1",
    checkPriceAction,
    replaceAction,
    ...o,
  };
  render(<FixScreen {...props} />);
  return { checkPriceAction, replaceAction, failed };
}

describe("FixScreen: a price rise", () => {
  it("the price_up fix page makes no lookup until Check today's price is tapped, and shows the money notice by it", async () => {
    const { checkPriceAction } = setup();
    expect(screen.getByRole("heading", { name: "The price went up" })).toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(checkPriceAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    expect(checkPriceAction).toHaveBeenCalledWith("r1", "o1");
  });

  it("after the check it shows old and new totals and carries the shown total", async () => {
    const { replaceAction, failed } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    expect(await screen.findByText("$54.20")).toHaveClass("line-through");
    expect(screen.getByText("Now $58.40")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Buy at about $58.40" }));
    const form = replaceAction.mock.calls[0][2];
    expect(replaceAction.mock.calls[0][1]).toBe("o1");
    expect(form.get("ideaId")).toBe(failed.id);
    expect(form.get("shownTotalCents")).toBe("5840");
    expect(form.get("over")).toBeNull();
    expect(await screen.findByText("Ordered")).toBeInTheDocument();
  });

  it("a fix that goes over the budget asks first and then reads Buy anyway", async () => {
    const { replaceAction } = setup({ budgetCents: 5000, overBudgetPct: 20, committedCents: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    await userEvent.click(await screen.findByRole("button", { name: "Buy at about $58.40" }));
    expect(replaceAction).not.toHaveBeenCalled();
    expect(await screen.findByText("$58.40 is $8.40 over the $50 budget.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, pick it" }));
    await userEvent.click(await screen.findByRole("button", { name: "Buy anyway · $58.40" }));
    expect(replaceAction.mock.calls[0][2].get("over")).toBe("1");
  });

  it("the next-best idea counts the round's other orders against the budget", async () => {
    const { replaceAction } = setup({ budgetCents: 7000, committedCents: 3000 });
    await userEvent.click(screen.getByRole("button", { name: "Buy this instead" }));
    expect(await screen.findByText("$76.80 is $6.80 over the $70 budget.")).toBeInTheDocument();
    expect(replaceAction).not.toHaveBeenCalled();
  });

  it("a stale tab whose failure was already fixed says so in neutral words", async () => {
    setup({}, { check: { ok: false, error: "not_current" } });
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    expect(await screen.findByText("This gift was already sorted out. Reload to see what happened.")).toBeInTheDocument();
    expect(screen.queryByText(/test accounts/)).toBeNull();
  });

  it("a gift with no live price offers no price check, only the next-best idea", () => {
    const { checkPriceAction } = setup({ idea: idea({ title: "From her list", livePrice: false }) });
    expect(screen.queryByRole("button", { name: "Check today's price" })).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.getByText("We can't check today's price for this one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy this instead" })).toBeInTheDocument();
    expect(checkPriceAction).not.toHaveBeenCalled();
  });

  it("a second price rise shows See all ideas", async () => {
    setup({ nextBest: null }, { check: { ok: false, error: "once" } });
    await userEvent.click(screen.getByRole("button", { name: "Check today's price" }));
    expect(await screen.findByText("The price went up again, so we won't try this one a third time.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy at/ })).toBeNull();
    expect(screen.getByRole("link", { name: "See all ideas" })).toHaveAttribute("href", "/rounds/r1");
  });
});

describe("FixScreen: the money notice", () => {
  it.each(["price_up", "out_of_stock", "address_rejected"])("is always shown by the buy buttons (%s)", (failureType) => {
    setup({ order: order({ failureType }), recipient: { kind: "own", city: "Dayton", state: "OH" } });
    expect(screen.getByText(zincFeeNotice(100))).toBeInTheDocument();
    expect(screen.getByText("This is a real purchase and can't be undone once placed.")).toBeInTheDocument();
  });
});

describe("FixScreen: other failures", () => {
  it("out of stock offers the next-best idea with Buy this instead", async () => {
    const { replaceAction, checkPriceAction } = setup({ order: order({ failureType: "out_of_stock" }) });
    expect(screen.getByRole("heading", { name: "It's out of stock" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check today's price" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Buy this instead" }));
    expect(replaceAction.mock.calls[0][2].get("ideaId")).not.toBeNull();
    expect(checkPriceAction).not.toHaveBeenCalled();
  });

  it("with no next-best idea the fix page shows See all ideas", () => {
    setup({ order: order({ failureType: "failed" }), nextBest: null });
    expect(screen.queryByRole("button", { name: "Buy this instead" })).toBeNull();
    expect(screen.getByRole("link", { name: "See all ideas" })).toHaveAttribute("href", "/rounds/r1");
  });

  it("an address failure offers me, another address, and their own address only when none is shared", async () => {
    const { replaceAction, failed } = setup({
      order: order({ failureType: "address_rejected" }),
      recipient: { kind: "own", city: "Dayton", state: "OH" },
    });
    expect(screen.queryByRole("button", { name: "Buy this instead" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ship it to me · buy for about $54.20" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Another address" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ship to Mom's address in Dayton, OH · buy for about $54.20" }));
    const form = replaceAction.mock.calls[0][2];
    expect(form.get("ideaId")).toBe(failed.id);
    expect(form.get("shipTo")).toBe("recipient");
  });

  it("with a shared address, an address failure doesn't offer it again", () => {
    setup({ order: order({ failureType: "address_withdrawn" }), recipient: { kind: "shared", city: "Dayton", state: "OH" } });
    expect(screen.getByRole("button", { name: "Ship it to me · buy for about $54.20" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mom's address/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add Mom's address" })).toBeNull();
  });

  it("with no address saved for them, it links to add theirs and back here", () => {
    setup({ order: order({ failureType: "address_rejected" }), recipient: { kind: "none" } });
    expect(screen.getByRole("link", { name: "Add Mom's address" })).toHaveAttribute(
      "href",
      `/people/p1/address?open=1&next=${encodeURIComponent("/rounds/r1/fix/o1")}`,
    );
  });

  it("another address over the budget asks with Buy anyway and then sends it", async () => {
    const { replaceAction } = setup({ order: order({ failureType: "address_rejected" }), budgetCents: 5000, overBudgetPct: 20 });
    await userEvent.click(screen.getByRole("button", { name: "Another address" }));
    await userEvent.type(screen.getByLabelText("First name"), "Ann");
    await userEvent.type(screen.getByLabelText("Last name"), "Lee");
    await userEvent.type(screen.getByLabelText("Street address"), "1 Main St");
    await userEvent.type(screen.getByLabelText("City"), "Tampa");
    await userEvent.selectOptions(screen.getByLabelText("State"), "FL");
    await userEvent.type(screen.getByLabelText("ZIP code"), "33602");
    await userEvent.click(screen.getByRole("button", { name: "Ship it here · buy for about $54.20" }));
    expect(replaceAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Yes, pick it" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Buy anyway · $54.20" }));
    const form = replaceAction.mock.calls[0][2];
    expect(form.get("over")).toBe("1");
    expect(form.get("shipTo")).toBe("other");
  });

  it("Ship it to me with no address of mine links to Settings and back", async () => {
    setup({ order: order({ failureType: "address_rejected" }), buyerAddress: null });
    expect(screen.getByRole("link", { name: "Add your address" })).toHaveAttribute(
      "href",
      `/settings/address?next=${encodeURIComponent("/rounds/r1/fix/o1")}`,
    );
  });
});
