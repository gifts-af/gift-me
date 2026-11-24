import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoundPageIdea, RoundPageOrder, RoundPageView } from "@/modules/concierge";
import { IdeaPhoto } from "@/components/idea-photo";
import { RoundScreen, type BudgetResult, type RejectResult } from "../[id]/round-screen";

// The round screen (ALL-29 Task 11). The server actions are faked here; the real ones run in the
// round journeys (Task 13) against local Supabase, and their module logic in approval-db.test.ts.

let n = 0;
function idea(o: Partial<RoundPageIdea> = {}): RoundPageIdea {
  n += 1;
  return {
    id: `i${n}`,
    title: `Idea ${n}`,
    reason: "Loves this kind of thing.",
    retailer: "amazon",
    productUrl: `https://www.amazon.com/dp/B0${n}`,
    imageUrl: null,
    source: "generated",
    listItemId: null,
    priceCents: 2500,
    totalCents: 3000,
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

function view(o: Partial<RoundPageView> = {}, round: Partial<RoundPageView["round"]> = {}): RoundPageView {
  return {
    round: {
      id: "r1",
      personId: "p1",
      personName: "Mom",
      occasionId: "o1",
      occasionKind: "birthday",
      occasionDate: "2026-12-18",
      shipByDeadline: "2026-12-09",
      budgetCents: 5000,
      status: "awaiting_approval",
      attentionReason: null,
      ...round,
    },
    overBudgetPct: 20,
    ideas: [],
    liveOrders: [],
    failedOrders: [],
    storeCancelled: [],
    closedText: null,
    nextBestIdeaId: null,
    buyYourself: [],
    ...o,
  };
}

function order(o: Partial<RoundPageOrder> = {}): RoundPageOrder {
  n += 1;
  return {
    id: `o${n}`,
    ideaId: `i${n}`,
    title: `Gift ${n}`,
    status: "shipped",
    failureType: null,
    totalCents: 4218,
    refundCents: null,
    maxPriceCents: 4600,
    feeCents: 100,
    estDeliveryDate: null,
    placedAt: "2026-12-01T10:00:00Z",
    deliveredAt: null,
    packages: [],
    handlingDaysMax: 2,
    deliveryDaysMax: 5,
    ...o,
  };
}

type ArrivedAction = (roundId: string, orderId: string) => Promise<{ ok: boolean }>;

function setup(
  v: RoundPageView,
  {
    outlook = true,
    arrived = vi.fn<ArrivedAction>(async () => ({ ok: true })),
    reactionsOpen = false,
  }: { outlook?: boolean | null; arrived?: ArrivedAction | null; reactionsOpen?: boolean } = {},
) {
  const rejectAction = vi.fn(async (...a: [string, FormData]): Promise<RejectResult> => (void a, { ok: true, more: true }));
  const setBudgetAction = vi.fn(async (...a: [string, FormData]): Promise<BudgetResult> => (void a, { ok: true }));
  const outlookAction = vi.fn(async (...a: [string, { code: string; ownedIdeaId: string | null; text: string | null }]) => (void a, outlook));
  render(
    <RoundScreen view={v} rejectAction={rejectAction} setBudgetAction={setBudgetAction} outlookAction={outlookAction} arrivedAction={arrived} reactionsOpen={reactionsOpen} />,
  );
  return { rejectAction, setBudgetAction, outlookAction, arrived };
}

const pick = (title: string) => userEvent.click(screen.getByRole("checkbox", { name: title }));

describe("RoundScreen: picking", () => {
  it("takes no ticks until the page can keep them (ALL-161)", async () => {
    const ok = async () => ({ ok: true }) as const;
    const ui = (
      <RoundScreen
        view={view({ ideas: [idea({ title: "Orchid" })] })}
        rejectAction={async () => ({ ok: true, more: true })}
        setBudgetAction={ok}
        outlookAction={async () => true}
        arrivedAction={ok}
        reactionsOpen={false}
      />
    );
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(ui);
    const box = () => container.querySelector('input[type="checkbox"]');
    expect(box()).toBeDisabled();
    await act(async () => void render(ui, { container, hydrate: true }));
    expect(box()).toBeEnabled();
  });

  it('ticking two ideas shows "2 picked · $60 of $50"', async () => {
    const a = idea({ title: "Orchid" });
    const b = idea({ title: "Cocotte" });
    setup(view({ ideas: [a, b] }));
    await pick("Orchid");
    expect(screen.getByText("1 picked · $30 of $50")).toBeInTheDocument();
    await pick("Cocotte");
    await userEvent.click(await screen.findByRole("button", { name: "Yes, pick it" }));
    expect(screen.getByText("2 picked · $60 of $50")).toBeInTheDocument();
    const buy = screen.getByRole("link", { name: "Buy 2 gifts" });
    expect(buy).toHaveAttribute("href", `/rounds/r1/buy?ideas=${a.id},${b.id}&over=1`);
  });

  it("within budget the Buy link carries no over flag", async () => {
    const a = idea({ title: "Orchid" });
    setup(view({ ideas: [a] }));
    await pick("Orchid");
    expect(screen.getByRole("link", { name: "Buy 1 gift" })).toHaveAttribute("href", `/rounds/r1/buy?ideas=${a.id}`);
  });

  it("ticking past the budget opens the sheet; Keep within budget unticks it", async () => {
    setup(view({ ideas: [idea({ title: "Orchid" }), idea({ title: "Cocotte" })] }));
    await pick("Orchid");
    await pick("Cocotte");
    expect(await screen.findByText("$60 is $10 over the $50 budget.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep within budget" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Keep within budget" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: "Cocotte" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Orchid" })).toBeChecked();
    expect(screen.getByText("1 picked · $30 of $50")).toBeInTheDocument();
  });

  it("past the allowance the bar says it's over the most you allowed and Buy is disabled", async () => {
    setup(view({ ideas: [idea({ title: "Orchid", totalCents: 4000 }), idea({ title: "Cocotte", totalCents: 4000 })] }));
    await pick("Orchid");
    await pick("Cocotte");
    expect(screen.getByText("2 picked · $80 of $50")).toBeInTheDocument();
    expect(screen.getByText("Over the most you allowed ($60)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Buy/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Buy 2 gifts" })).toBeDisabled();
  });

  it("with no budget the bar shows the total alone and asks nothing", async () => {
    setup(view({ ideas: [idea({ title: "Orchid", totalCents: 9000 })] }, { budgetCents: null }));
    await pick("Orchid");
    expect(screen.getByText("1 picked · $90")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, pick it" })).toBeNull();
  });

  it("list gifts come first; a claimed one is greyed and can't be ticked", async () => {
    const ai = idea({ title: "AI gift", rank: 0 });
    const list = idea({ title: "From the list", source: "list", listItemId: "li1", rank: 1 });
    const claimed = idea({ title: "Taken gift", source: "list", listItemId: "li2", rank: 2, claimed: true });
    setup(view({ ideas: [ai, list, claimed] }));
    const boxes = screen.getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"));
    expect(boxes).toEqual(["From the list", "Taken gift", "AI gift"]);
    expect(screen.getByRole("heading", { name: "On their list" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Taken gift" })).toBeDisabled();
    expect(screen.getByText("Someone else is getting this")).toBeInTheDocument();
    await pick("Taken gift");
    expect(screen.getByRole("checkbox", { name: "Taken gift" })).not.toBeChecked();
  });

  it("a list gift priced from the list (a store Zinc can only check) says so; a live-priced one doesn't (AC-27)", () => {
    setup(
      view({
        ideas: [
          idea({ title: "Camp mug", source: "list", listItemId: "li5", livePrice: false }),
          idea({ title: "Tote", source: "list", listItemId: "li6", livePrice: true }),
        ],
      }),
    );
    const mug = screen.getByRole("checkbox", { name: "Camp mug" }).closest("label")!;
    expect(within(mug).getByText(/Price from their list/)).toBeInTheDocument();
    const tote = screen.getByRole("checkbox", { name: "Tote" }).closest("label")!;
    expect(within(tote).queryByText(/Price from their list/)).toBeNull();
  });

  it("a list gift already on one of the buyer's orders can't be ticked", () => {
    setup(view({ ideas: [idea({ title: "Mine already", source: "list", listItemId: "li3", claimedByMe: true })] }));
    expect(screen.getByRole("checkbox", { name: "Mine already" })).toBeDisabled();
    expect(screen.getByText("Already on one of your orders")).toBeInTheDocument();
  });

  it("a no-longer-shared one says so and can't be ticked", () => {
    setup(view({ ideas: [idea({ title: "Gone gift", source: "list", listItemId: "li4", noLongerShared: true })] }));
    expect(screen.getByRole("checkbox", { name: "Gone gift" })).toBeDisabled();
    expect(screen.getByText("No longer shared")).toBeInTheDocument();
  });

  it("a gift that wasn't offered shows Buy it yourself linking to its page", () => {
    setup(
      view({
        ideas: [idea({ title: "Orchid" })],
        buyYourself: [
          {
            itemId: "li9",
            name: "Pottery class",
            productUrl: "https://pottery.example/class",
            storeName: "pottery.example",
            priceCents: 8000,
            imageUrl: null,
            claimed: false,
            claimedByMe: false,
          },
        ],
      }),
    );
    expect(screen.getByRole("heading", { name: "From their list" })).toBeInTheDocument();
    const row = screen.getByText("Pottery class").closest("li")!;
    const link = within(row).getByRole("link", { name: "Buy it yourself" });
    expect(link).toHaveAttribute("href", "https://pottery.example/class");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("RoundScreen: picks after the round changes", () => {
  function props() {
    return {
      rejectAction: vi.fn(async (...a: [string, FormData]): Promise<RejectResult> => (void a, { ok: true, more: true })),
      setBudgetAction: vi.fn(async (...a: [string, FormData]): Promise<BudgetResult> => (void a, { ok: true })),
      outlookAction: vi.fn(async (...a: [string, { code: string; ownedIdeaId: string | null; text: string | null }]) => (void a, true)),
      arrivedAction: null,
      reactionsOpen: false,
    };
  }

  it("a ticked idea that's since been rejected drops out: no picks and Buy disabled", async () => {
    const a = idea({ title: "Orchid" });
    const p = props();
    const { rerender } = render(<RoundScreen view={view({ ideas: [a] })} {...p} />);
    await pick("Orchid");
    rerender(<RoundScreen view={view({ ideas: [{ ...a, status: "rejected" }] }, { status: "generating" })} {...p} />);
    expect(screen.queryByText(/picked/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Buy/ })).toBeNull();
  });

  it("a ticked idea that can't be picked any more leaves the bar and the Buy link", async () => {
    const a = idea({ title: "Orchid" });
    const b = idea({ title: "Cocotte", source: "list", listItemId: "li1" });
    const p = props();
    const { rerender } = render(<RoundScreen view={view({ ideas: [a, b] })} {...p} />);
    await pick("Orchid");
    await pick("Cocotte");
    await userEvent.click(await screen.findByRole("button", { name: "Yes, pick it" }));
    rerender(<RoundScreen view={view({ ideas: [a, { ...b, claimed: true }] })} {...p} />);
    expect(screen.getByText("1 picked · $30 of $50")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buy 1 gift" })).toHaveAttribute("href", `/rounds/r1/buy?ideas=${a.id}`);
  });

  it("None of these clears the picks", async () => {
    const a = idea({ title: "Orchid" });
    const p = props();
    render(<RoundScreen view={view({ ideas: [a, idea({ title: "Cocotte" })] })} {...p} />);
    await pick("Orchid");
    await userEvent.click(screen.getByRole("button", { name: "None of these" }));
    await userEvent.click(await screen.findByRole("button", { name: "Too generic" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find new ideas" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Find new ideas" }));
    expect(await screen.findByText("Looking again. New ideas will come by email.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Orchid" })).not.toBeChecked();
    expect(screen.getByText("Pick one or more")).toBeInTheDocument();
  });

  it("a budget saved under ticked picks offers the over-budget sheet instead of a silent dead button", async () => {
    const a = idea({ title: "Orchid", totalCents: 5500 });
    const p = props();
    const { rerender } = render(<RoundScreen view={view({ ideas: [a] }, { budgetCents: null })} {...p} />);
    await pick("Orchid");
    rerender(<RoundScreen view={view({ ideas: [a] }, { budgetCents: 5000 })} {...p} />);
    expect(screen.getByRole("button", { name: "Buy 1 gift" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Over budget: review" }));
    expect(await screen.findByText("$55 is $5 over the $50 budget.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, pick it" }));
    expect(screen.getByRole("link", { name: "Buy 1 gift" })).toHaveAttribute("href", `/rounds/r1/buy?ideas=${a.id}&over=1`);
  });

  it("Keep within budget from the review unticks the last pick", async () => {
    const a = idea({ title: "Orchid", totalCents: 5500 });
    const p = props();
    const { rerender } = render(<RoundScreen view={view({ ideas: [a] }, { budgetCents: null })} {...p} />);
    await pick("Orchid");
    rerender(<RoundScreen view={view({ ideas: [a] }, { budgetCents: 5000 })} {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Over budget: review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep within budget" }));
    expect(screen.getByRole("checkbox", { name: "Orchid" })).not.toBeChecked();
  });

  it("going past the allowance forgets an earlier Yes, pick it", async () => {
    const p = props();
    render(
      <RoundScreen
        view={view({ ideas: [idea({ title: "A", totalCents: 3000 }), idea({ title: "B", totalCents: 2500 }), idea({ title: "C", totalCents: 2000 })] })}
        {...p}
      />,
    );
    await pick("A");
    await pick("B");
    await userEvent.click(await screen.findByRole("button", { name: "Yes, pick it" }));
    await pick("C"); // $75: past the $60 allowance
    expect(screen.getByRole("button", { name: "Buy 3 gifts" })).toBeDisabled();
    await pick("C"); // back to $55: over, and asks again rather than trusting the old Yes
    expect(screen.queryByRole("link", { name: /Buy/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Over budget: review" })).toBeInTheDocument();
  });
});

describe("RoundScreen: budget", () => {
  it("offers Your budget when the round has none and sends the amount", async () => {
    const { setBudgetAction } = setup(view({ ideas: [idea()] }, { budgetCents: null }));
    await userEvent.type(screen.getByLabelText("Your budget"), "55");
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(setBudgetAction).toHaveBeenCalledTimes(1));
    const [roundId, form] = setBudgetAction.mock.calls[0];
    expect(roundId).toBe("r1");
    expect(form.get("budget")).toBe("55");
  });

  it("doesn't offer Your budget once the round has one", () => {
    setup(view({ ideas: [idea()] }));
    expect(screen.queryByLabelText("Your budget")).toBeNull();
  });
});

describe("RoundScreen: None of these", () => {
  it("Already has one asks Which one? before it can be sent", async () => {
    const a = idea({ title: "Orchid" });
    const b = idea({ title: "Cocotte" });
    const { rejectAction, outlookAction } = setup(view({ ideas: [a, b] }));
    await userEvent.click(screen.getByRole("button", { name: "None of these" }));
    await userEvent.click(await screen.findByRole("button", { name: "Already has one" }));
    expect(screen.getByText("Which one?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find new ideas" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Cocotte" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find new ideas" })).toBeEnabled());
    expect(outlookAction).toHaveBeenLastCalledWith("r1", { code: "has_it", ownedIdeaId: b.id, text: null });
    await userEvent.click(screen.getByRole("button", { name: "Find new ideas" }));
    await waitFor(() => expect(rejectAction).toHaveBeenCalledTimes(1));
    const form = rejectAction.mock.calls[0][1];
    expect(form.get("code")).toBe("has_it");
    expect(form.get("owned")).toBe(b.id);
    expect(form.get("expectMore")).toBe("1");
    expect(await screen.findByText("Looking again. New ideas will come by email.")).toBeInTheDocument();
  });

  it("with no search left the sheet says No more new ideas this time before confirming", async () => {
    const { rejectAction } = setup(view({ ideas: [idea()] }), { outlook: false });
    await userEvent.click(screen.getByRole("button", { name: "None of these" }));
    await userEvent.click(await screen.findByRole("button", { name: "Too generic" }));
    expect(await screen.findByText("No more new ideas this time")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Anything else? (optional)"), "Rather an experience");
    await userEvent.click(screen.getByRole("button", { name: "Save the reason" }));
    await waitFor(() => expect(rejectAction).toHaveBeenCalledTimes(1));
    const form = rejectAction.mock.calls[0][1];
    expect(form.get("code")).toBe("too_generic");
    expect(form.get("text")).toBe("Rather an experience");
    expect(form.get("expectMore")).toBe("0");
  });

  it("when the outlook changed it says so and asks again", async () => {
    const { rejectAction, outlookAction } = setup(view({ ideas: [idea()] }));
    rejectAction.mockResolvedValueOnce({ ok: false, error: "changed" });
    await userEvent.click(screen.getByRole("button", { name: "None of these" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not their style" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find new ideas" })).toBeEnabled());
    outlookAction.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Find new ideas" }));
    expect(await screen.findByText("No more new ideas this time")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That changed. Check and send again.");
  });

  it("None of these isn't shown on an ordered round", () => {
    setup(
      view(
        {
          ideas: [idea({ title: "Orchid", status: "selected" })],
          closedText: "Already ordered: Orchid",
          liveOrders: [order({ ideaId: "i1", title: "Orchid", status: "placed", totalCents: 3000 })],
        },
        { status: "ordered" },
      ),
    );
    expect(screen.getByText("Already ordered: Orchid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "None of these" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("RoundScreen: your gifts", () => {
  // The occasion is Fri, Dec 18 (view()); the gift's photo and store come from its idea.
  const gifts = () => within(screen.getByRole("region", { name: "Your gifts" }));
  const ordered = (o: Partial<RoundPageOrder>) => {
    const i = idea({ title: "Cozy throw", retailer: "walmart", status: "selected" });
    return { i, o: order({ ideaId: i.id, title: "Cozy throw", ...o }) };
  };

  it("shipped shows Shipped · due <date> · Track it, opening the carrier page in a new tab, and It arrived", () => {
    const { i, o } = ordered({
      estDeliveryDate: "2026-12-14",
      packages: [{ carrier: "UPS", trackingNumber: "1Z 999", status: null, estimatedDeliveryDate: "2026-12-14", trackingUrl: null }],
    });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    const item = gifts().getByRole("listitem");
    expect(item).toHaveTextContent("Cozy throw");
    expect(item).toHaveTextContent("$42.18 · Walmart");
    expect(item).toHaveTextContent("Shipped · due Mon, Dec 14 · Track it ↗");
    const link = within(item).getByRole("link", { name: /Track it/ });
    expect(link).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1Z%20999");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(item).getByRole("button", { name: "It arrived" })).toBeInTheDocument();
  });

  it("shipped with no public tracking page (Amazon) has no Track it link", () => {
    const { i, o } = ordered({
      estDeliveryDate: "2026-12-14",
      packages: [{ carrier: "Amazon", trackingNumber: "TBA123", status: null, estimatedDeliveryDate: "2026-12-14", trackingUrl: null }],
    });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    const item = gifts().getByRole("listitem");
    expect(item).toHaveTextContent("Shipped · due Mon, Dec 14");
    expect(within(item).queryByRole("link")).toBeNull();
  });

  it("late shows an amber May arrive <date> · <n> days late chip", () => {
    const { i, o } = ordered({ estDeliveryDate: "2026-12-20" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    const chip = gifts().getByText("May arrive Sun, Dec 20 · 2 days late");
    expect(chip).toHaveClass("bg-warning-soft", "text-warning");
    expect(gifts().getByRole("button", { name: "It arrived" })).toBeInTheDocument();
  });

  it("placed shows Ordered · usually arrives by the end of the store's range", () => {
    // Placed Tue, Dec 1, plus 2 handling and 5 delivery days.
    const { i, o } = ordered({ status: "placed" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    expect(gifts().getByRole("listitem")).toHaveTextContent("Ordered · usually arrives by Tue, Dec 8");
  });

  it("no It arrived on a placed gift", () => {
    const { i, o } = ordered({ status: "placed", estDeliveryDate: "2026-12-10" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    expect(gifts().queryByRole("button", { name: "It arrived" })).toBeNull();
  });

  it("delivered shows Delivered <date>", () => {
    const { i, o } = ordered({ status: "delivered", deliveredAt: "2026-12-10T15:00:00Z", estDeliveryDate: "2026-12-20" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "delivered" }));
    const item = gifts().getByRole("listitem");
    expect(item).toHaveTextContent("Delivered Thu, Dec 10");
    expect(item).not.toHaveTextContent("late");
    expect(within(item).queryByRole("button")).toBeNull();
  });

  it("a delivered gift asks how it went, once it can be answered", () => {
    const { i, o } = ordered({ status: "delivered" });
    const shipped = order({ status: "shipped" });
    setup(view({ ideas: [i], liveOrders: [o, shipped] }, { status: "ordered" }), { reactionsOpen: true });
    expect(gifts().getAllByRole("link", { name: `How did it go? ${o.title}` }).map((a) => a.getAttribute("href"))).toEqual([`/rounds/r1/reaction?gift=${o.id}`]);
  });

  it("no How did it go? before then", () => {
    const { i, o } = ordered({ status: "delivered" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "delivered" }));
    expect(gifts().queryByRole("link", { name: /How did it go/ })).toBeNull();
  });

  it("store cancelled before the ship-by date shows the refund chip and Choose another gift, not a second fix row", () => {
    // Zinc refunded $40.50 of the $42.18 charged: the chip says what came back.
    const { i, o } = ordered({ status: "failed", failureType: "store_cancelled", refundCents: 4050 });
    setup(view({ ideas: [i], failedOrders: [o], storeCancelled: [o] }, { status: "needs_attention" }));
    const item = gifts().getByRole("listitem");
    expect(within(item).getByText("The store cancelled it · $40.50 back in Zinc")).toHaveClass("bg-warning-soft", "text-warning");
    expect(within(item).getByRole("link", { name: "Choose another gift" })).toHaveAttribute("href", `/rounds/r1/fix/${o.id}`);
    expect(screen.queryByRole("heading", { name: "Needs a fix" })).toBeNull();
  });

  it("store cancelled after the ship-by date shows the refund chip and no link", () => {
    const { i, o } = ordered({ status: "failed", failureType: "store_cancelled", refundCents: 4218 });
    setup(view({ ideas: [i], storeCancelled: [o], closedText: "This occasion has passed" }, { status: "skipped" }));
    const item = gifts().getByRole("listitem");
    expect(item).toHaveTextContent("The store cancelled it · $42.18 back in Zinc");
    expect(within(item).queryByRole("link")).toBeNull();
  });

  it("store cancelled with no refund amount from Zinc says the money is back, never the order's total", () => {
    const { i, o } = ordered({ status: "failed", failureType: "store_cancelled", refundCents: null });
    setup(view({ ideas: [i], storeCancelled: [o], closedText: "This occasion has passed" }, { status: "skipped" }));
    const item = gifts().getByRole("listitem");
    expect(item).toHaveTextContent("The store cancelled it · the money is back in Zinc");
    expect(within(item).getByText(/The store cancelled it/)).not.toHaveTextContent("$");
  });

  it("the Ideas list drops the gifts under Your gifts and keeps the rest (owner, 2026-11-23)", () => {
    // A store cancel before ship-by keeps the round open, so the ideas are still shown.
    const { i, o } = ordered({ status: "failed", failureType: "store_cancelled" });
    const shipped = idea({ title: "Orchid", status: "selected" });
    const rest = idea({ title: "Cocotte" });
    const live = order({ ideaId: shipped.id, title: "Orchid" });
    setup(view({ ideas: [i, shipped, rest], liveOrders: [live], failedOrders: [o], storeCancelled: [o] }, { status: "needs_attention" }));
    expect(gifts().getAllByRole("listitem")).toHaveLength(2);
    const ideas = within(screen.getByRole("region", { name: "Ideas" }));
    expect(ideas.getAllByRole("listitem")).toHaveLength(1);
    expect(ideas.getByText("Cocotte")).toBeInTheDocument();
    expect(ideas.queryByText("Cozy throw")).toBeNull();
    expect(ideas.queryByText("Orchid")).toBeNull();
  });

  it("It arrived sends the order and, refused, says so", async () => {
    const { i, o } = ordered({});
    const arrived = vi.fn<ArrivedAction>(async () => ({ ok: false }));
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }), { arrived });
    await userEvent.click(gifts().getByRole("button", { name: "It arrived" }));
    await waitFor(() => expect(arrived).toHaveBeenCalledWith("r1", o.id));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Reload and try again.");
  });

  it("with tracking switched off there's no It arrived", () => {
    const { i, o } = ordered({});
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }), { arrived: null });
    expect(gifts().getByRole("listitem")).toHaveTextContent("Shipped");
    expect(gifts().queryByRole("button", { name: "It arrived" })).toBeNull();
  });

  it("no Your gifts list before anything is bought", () => {
    setup(view({ ideas: [idea()] }));
    expect(screen.queryByRole("region", { name: "Your gifts" })).toBeNull();
  });
});

describe("IdeaPhoto", () => {
  it("the photo has referrerpolicy no-referrer; with no url the gift icon shows", () => {
    const { rerender } = render(<IdeaPhoto url="https://m.media-amazon.com/images/I/x.jpg" title="Orchid" />);
    const img = screen.getByRole("img", { name: "Orchid" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img).toHaveAttribute("loading", "lazy");
    rerender(<IdeaPhoto url={null} title="Orchid" />);
    const icon = screen.getByRole("img", { name: "Orchid" });
    expect(icon.tagName).not.toBe("IMG");
    expect(icon.querySelector("svg")).not.toBeNull();
  });
});
