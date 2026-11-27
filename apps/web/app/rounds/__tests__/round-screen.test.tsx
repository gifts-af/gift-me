import { renderToString } from "react-dom/server";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RejectionOutlook, RoundPageIdea, RoundPageOrder, RoundPageView } from "@/modules/concierge";
import { IdeaPhoto } from "@/components/idea-photo";
import { RoundScreen, type BudgetResult, type RejectResult } from "../[id]/round-screen";
import type { PickAgainResult, SkipResult } from "../ways-out";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
      today: "2026-12-01",
      ...round,
    },
    overBudgetPct: 20,
    ideas: [],
    liveOrders: [],
    failedOrders: [],
    storeCancelled: [],
    closedText: null,
    waiting: null,
    hold: null,
    restored: null,
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

const OUTLOOK: RejectionOutlook = { more: true, saves: true, cheaper: false };

function setup(
  v: RoundPageView,
  {
    outlook = {},
    arrived = vi.fn<ArrivedAction>(async () => ({ ok: true })),
    reactionsOpen = false,
  }: { outlook?: Partial<RejectionOutlook> | null; arrived?: ArrivedAction | null; reactionsOpen?: boolean } = {},
) {
  const rejectAction = vi.fn(async (...a: [string, FormData]): Promise<RejectResult> => (void a, { ok: true, more: true, saved: true }));
  const setBudgetAction = vi.fn(async (...a: [string, FormData]): Promise<BudgetResult> => (void a, { ok: true }));
  const outlookAction = vi.fn(async (...a: [string, { code: string; ownedIdeaId: string | null; text: string | null }]) => (void a, outlook === null ? null : { ...OUTLOOK, ...outlook }));
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
        rejectAction={async () => ({ ok: true, more: true, saved: true })}
        setBudgetAction={ok}
        outlookAction={async () => OUTLOOK}
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

  it("a list gift that failed here needs a fix: it isn't on an order, and can't be ticked", () => {
    const reel = idea({ title: "Fly reel", source: "list", listItemId: "li8", claimedByMe: true, status: "selected" });
    const failed = order({ ideaId: reel.id, title: "Fly reel", status: "failed", failureType: "out_of_stock" });
    setup(view({ ideas: [reel], failedOrders: [failed] }, { status: "needs_attention" }));
    expect(screen.queryByText("Already on one of your orders")).toBeNull();
    const list = within(screen.getByRole("region", { name: "On their list" }));
    expect(list.getByText("Needs a fix")).toBeInTheDocument();
    expect(list.queryByRole("checkbox")).toBeNull();
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
      rejectAction: vi.fn(async (...a: [string, FormData]): Promise<RejectResult> => (void a, { ok: true, more: true, saved: true })),
      setBudgetAction: vi.fn(async (...a: [string, FormData]): Promise<BudgetResult> => (void a, { ok: true })),
      outlookAction: vi.fn(async (...a: [string, { code: string; ownedIdeaId: string | null; text: string | null }]) => (void a, OUTLOOK)),
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
    const { rejectAction } = setup(view({ ideas: [idea()] }), { outlook: { more: false } });
    await userEvent.click(screen.getByRole("button", { name: "None of these" }));
    await userEvent.click(await screen.findByRole("button", { name: "Too generic" }));
    expect(await screen.findByText(/^No more new ideas this time/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Anything else? (optional)"), "Rather an experience");
    await userEvent.click(await screen.findByRole("button", { name: "Save the reason" }));
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
    outlookAction.mockResolvedValueOnce({ ...OUTLOOK, more: false });
    await userEvent.click(screen.getByRole("button", { name: "Find new ideas" }));
    expect(await screen.findByText(/^No more new ideas this time/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That changed. Check and send again.");
  });

  describe("says only what the server says", () => {
    const AVOID = "The reason is saved for next time.";
    const status = () => screen.getByRole("status", { name: "What happens" });

    async function open(outlook: Partial<RejectionOutlook> | null) {
      const p = setup(view({ ideas: [idea({ title: "Orchid" })] }), { outlook });
      await userEvent.click(screen.getByRole("button", { name: "None of these" }));
      return p;
    }
    const chip = async (name: string) => userEvent.click(await screen.findByRole("button", { name }));

    it("before a reason is chosen it promises nothing", async () => {
      await open({});
      expect(status()).toHaveTextContent(/^$/);
    });

    it.each<[Partial<RejectionOutlook>, string]>([
      [{ saves: true }, AVOID],
      [{ saves: true, cheaper: true }, "The reason is saved, and the next ideas will cost less."],
      [{ saves: false, cheaper: true }, "The next ideas will cost less."],
      [{ saves: false }, "We'll leave these out this time."],
      [{ more: false, saves: true }, "No more new ideas this time. The reason is saved, and these ideas stay here to buy."],
      [{ more: false, saves: false }, "No more new ideas this time. These ideas stay here to buy."],
    ])("%o", async (outlook, text) => {
      await open(outlook);
      await chip("Too pricey");
      await waitFor(() => expect(status()).toHaveTextContent(new RegExp(`^${text.replace(/[.()]/g, "\\$&")}$`)));
    });

    it("a new choice clears the last answer until the server says", async () => {
      const p = await open({ saves: true });
      await chip("Not their style");
      await waitFor(() => expect(status()).toHaveTextContent(AVOID));
      let answer!: (o: RejectionOutlook) => void;
      p.outlookAction.mockImplementationOnce((...a) => (void a, new Promise((r) => (answer = r))));
      await chip("Too pricey");
      expect(status()).toHaveTextContent(/^$/);
      expect(screen.getByRole("button", { name: "Find new ideas" })).toBeDisabled();
      answer({ more: true, saves: false, cheaper: true });
      await waitFor(() => expect(status()).toHaveTextContent("The next ideas will cost less."));
    });

    it("typing clears the answer, and asks again by itself with the new text", async () => {
      const p = await open({ saves: false });
      await chip("Too pricey");
      await waitFor(() => expect(status()).toHaveTextContent("We'll leave these out this time."));
      p.outlookAction.mockResolvedValue({ more: true, saves: true, cheaper: false });
      await userEvent.type(screen.getByLabelText(/Anything else/), "No glass");
      expect(screen.getByRole("button", { name: "Find new ideas" })).toBeDisabled();
      await waitFor(() => expect(status()).toHaveTextContent(AVOID), { timeout: 3000 });
      expect(p.outlookAction).toHaveBeenLastCalledWith("r1", { code: "too_pricey", ownedIdeaId: null, text: "No glass" });
    });

    it("an answer for older text is dropped", async () => {
      const p = await open({ saves: false });
      let late!: (o: RejectionOutlook) => void;
      p.outlookAction.mockImplementationOnce((...a) => (void a, new Promise((r) => (late = r))));
      await chip("Not their style");
      await chip("Too generic");
      await waitFor(() => expect(status()).toHaveTextContent("We'll leave these out this time."));
      late({ more: false, saves: true, cheaper: false });
      await new Promise((r) => setTimeout(r, 20));
      expect(status()).toHaveTextContent("We'll leave these out this time.");
    });

    it("nothing can be changed while it's being sent", async () => {
      const p = await open({});
      await chip("Not their style");
      let done!: (r: RejectResult) => void;
      p.rejectAction.mockImplementationOnce((...a) => (void a, new Promise((r) => (done = r))));
      await userEvent.click(await screen.findByRole("button", { name: "Find new ideas" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Too pricey" })).toBeDisabled());
      expect(screen.getByLabelText(/Anything else/)).toBeDisabled();
      done({ ok: true, more: true, saved: true });
      expect(await screen.findByText("Looking again. New ideas will come by email.")).toBeInTheDocument();
    });

    it("Already has one needs to know which", async () => {
      await open({});
      await chip("Not their style");
      await waitFor(() => expect(screen.getByRole("button", { name: "Find new ideas" })).toBeEnabled());
      await chip("Already has one");
      expect(screen.getByRole("button", { name: "Find new ideas" })).toBeDisabled();
    });

    it("a check that failed can be tried again", async () => {
      const p = await open(null);
      await chip("Not their style");
      expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through.");
      p.outlookAction.mockResolvedValueOnce({ more: true, saves: false, cheaper: false });
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(status()).toHaveTextContent("We'll leave these out this time."));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("when it changed and the new answer can't be read, it doesn't say to check and send", async () => {
      const p = await open({});
      await chip("Not their style");
      p.rejectAction.mockResolvedValueOnce({ ok: false, error: "changed" });
      await waitFor(() => expect(screen.getByRole("button", { name: "Find new ideas" })).toBeEnabled());
      p.outlookAction.mockResolvedValueOnce(null);
      await userEvent.click(screen.getByRole("button", { name: "Find new ideas" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through.");
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    });

    it("a late answer for older text is dropped", async () => {
      const p = await open({ saves: false });
      await chip("Too pricey");
      await waitFor(() => expect(status()).toHaveTextContent("We'll leave these out this time."));
      let late!: (o: RejectionOutlook) => void;
      p.outlookAction.mockImplementationOnce((...a) => (void a, new Promise((r) => (late = r))));
      const box = screen.getByLabelText(/Anything else/);
      await userEvent.type(box, "No");
      await waitFor(() => expect(p.outlookAction).toHaveBeenLastCalledWith("r1", { code: "too_pricey", ownedIdeaId: null, text: "No" }), { timeout: 3000 });
      await userEvent.type(box, " glass");
      late({ more: false, saves: true, cheaper: false });
      await waitFor(() => expect(p.outlookAction).toHaveBeenLastCalledWith("r1", { code: "too_pricey", ownedIdeaId: null, text: "No glass" }), { timeout: 3000 });
      await waitFor(() => expect(status()).toHaveTextContent("We'll leave these out this time."));
    });

    it("with no search left the button keeps the ideas, and the page says what was saved", async () => {
      const p = await open({ more: false, saves: false });
      p.rejectAction.mockResolvedValue({ ok: true, more: false, saved: false });
      await chip("Not their style");
      await userEvent.click(await screen.findByRole("button", { name: "Keep these ideas" }));
      expect(await screen.findByText("These ideas are still here to buy.")).toBeInTheDocument();
      expect(screen.queryByText(/Saved/)).toBeNull();
    });

    it("the page's Saved comes from the server's answer to sending, not the sheet's", async () => {
      const p = await open({ more: false, saves: true });
      p.rejectAction.mockResolvedValue({ ok: true, more: false, saved: false });
      await chip("Not their style");
      await userEvent.click(await screen.findByRole("button", { name: "Save the reason" }));
      expect(await screen.findByText("These ideas are still here to buy.")).toBeInTheDocument();
    });
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

describe("RoundScreen: dates and what's happening", () => {
  it("says the last day a gift can really be chosen", () => {
    setup(view({ ideas: [idea({ title: "Orchid" })] }));
    expect(screen.getByText(/Choose by Tue, Dec 8/)).toBeInTheDocument();
  });

  it("looking says so", () => {
    setup(view({ waiting: "looking" }, { status: "scheduled" }));
    expect(screen.getByText("Looking for new ideas. They'll come by email.")).toBeInTheDocument();
  });

  it("after the no-ideas email it says so, and not that it's looking", () => {
    setup(view({ waiting: "told" }, { status: "scheduled" }));
    expect(screen.getByText("We haven't found ideas that fit yet. We emailed you about it.")).toBeInTheDocument();
    expect(screen.queryByText(/Looking for new ideas/)).toBeNull();
  });

  it("with no address it asks, opens the form and comes back here", () => {
    setup(view({ waiting: "address" }, { status: "needs_address" }));
    expect(screen.getByText("We need Mom's address before we can look for gifts.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add address" })).toHaveAttribute("href", `/people/p1/address?open=1&next=${encodeURIComponent("/rounds/r1")}`);
  });

  it.each([
    ["none", "We didn't find anything new. These are still here if you want one."],
    ["failed", "We couldn't finish looking. These are still here if you want one."],
  ] as const)("AC-20: ideas that came back after %s say so above the list and the ideas", (restored, line) => {
    setup(view({ restored, ideas: [idea({ source: "list", listItemId: "li1" }), idea()] }));
    const shown = screen.getByText(line);
    const heading = screen.getByRole("heading", { name: "On their list" });
    expect(shown.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("AC-20: no such line otherwise, once the round can't be bought from, or with no idea shown", () => {
    for (const v of [view({ ideas: [idea()] }), view({ restored: "none", closedText: "This occasion has passed", ideas: [idea()] }), view({ restored: "none" })]) {
      setup(v);
    }
    expect(screen.queryByText(/still here if you want one/)).toBeNull();
  });

  it("says nothing when nothing is being looked for", () => {
    setup(view({ waiting: null }, { status: "generating" }));
    expect(screen.queryByText(/Looking for new ideas|haven't found ideas|address before/)).toBeNull();
  });
});

describe("RoundScreen: your gifts", () => {
  // The occasion is Fri, Dec 18 (view()); the gift's photo and store come from its idea.
  const gifts = () => within(screen.getByRole("region", { name: "Your gifts" }));
  const ordered = (o: Partial<RoundPageOrder>) => {
    const i = idea({ title: "Cozy throw", retailer: "walmart", status: "selected" });
    return { i, o: order({ ideaId: i.id, title: "Cozy throw", ...o }) };
  };

  it("shipped shows Shipped · due <date> · Track it, opening the carrier page in a new tab, and Mark as arrived", () => {
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
    expect(within(item).getByRole("button", { name: "Mark as arrived" })).toBeInTheDocument();
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
    expect(gifts().getByRole("button", { name: "Mark as arrived" })).toBeInTheDocument();
  });

  it("placed shows Ordered · usually arrives by the end of the store's range", () => {
    // Placed Tue, Dec 1, plus 2 handling and 5 delivery days.
    const { i, o } = ordered({ status: "placed" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    expect(gifts().getByRole("listitem")).toHaveTextContent("Ordered · usually arrives by Tue, Dec 8");
  });

  it("no Mark as arrived on a placed gift", () => {
    const { i, o } = ordered({ status: "placed", estDeliveryDate: "2026-12-10" });
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }));
    expect(gifts().queryByRole("button", { name: "Mark as arrived" })).toBeNull();
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

  it("Mark as arrived sends the order and, refused, says so", async () => {
    const { i, o } = ordered({});
    const arrived = vi.fn<ArrivedAction>(async () => ({ ok: false }));
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }), { arrived });
    await userEvent.click(gifts().getByRole("button", { name: "Mark as arrived" }));
    await waitFor(() => expect(arrived).toHaveBeenCalledWith("r1", o.id));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Reload and try again.");
  });

  it("with tracking switched off there's no Mark as arrived", () => {
    const { i, o } = ordered({});
    setup(view({ ideas: [i], liveOrders: [o] }, { status: "ordered" }), { arrived: null });
    expect(gifts().getByRole("listitem")).toHaveTextContent("Shipped");
    expect(gifts().queryByRole("button", { name: "Mark as arrived" })).toBeNull();
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

// ALL-167: a held gift says why, in Home's words, and how to move it on.
describe("a held gift", () => {
  const held = (kind: string, text: string, about: "both" | "first" = "both") => {
    const orders = [order({ status: "held", placedAt: null, title: "Mug" }), order({ status: "held", placedAt: null, title: "Vase" })];
    const orderIds = (about === "both" ? orders : orders.slice(0, 1)).map((o) => o.id);
    return render(
      <RoundScreen
        view={view({ liveOrders: orders, hold: kind === "" ? null : ({ kind, text, orderIds } as RoundPageView["hold"]) }, { status: "needs_attention" })}
        rejectAction={vi.fn()}
        setBudgetAction={vi.fn()}
        outlookAction={vi.fn()}
        arrivedAction={null}
        reactionsOpen={false}
        walletUrl="https://zinc.test/wallet"
      />,
    );
  };
  const address = `/people/p1/address?open=1&next=${encodeURIComponent("/rounds/r1")}`;

  it.each([
    ["address", "Needs an address", "Add address", address],
    ["check_address", "Check the address", "Open the address", address],
    ["change_address", "Needs an address", "Change address", address],
    ["setup", "Waiting on payment setup", "Finish setup", "/settings/paying"],
    ["funds", "Waiting on your Zinc balance", "Top up your Zinc balance", "https://zinc.test/wallet"],
  ])("%s", (kind, text, label, href) => {
    held(kind, text);
    const gifts = screen.getByRole("region", { name: "Your gifts" });
    expect(gifts).toHaveTextContent(text);
    expect(gifts).not.toHaveTextContent("Ordering");
    for (const link of within(gifts).getAllByRole("link")) {
      expect(link).toHaveTextContent(label);
      expect(link).toHaveAttribute("href", href);
    }
    // Never the same words twice on one row.
    expect(label).not.toBe(text);
  });

  it.each([
    ["waiting", "Waiting to order"],
    ["cancel_only", "Needs an address"],
    ["", "Not ordered"],
  ])("%s has nothing to do here", (kind, text) => {
    held(kind, text);
    const gifts = screen.getByRole("region", { name: "Your gifts" });
    expect(gifts).toHaveTextContent(text);
    expect(within(gifts).queryByRole("link")).toBeNull();
  });

  it("says where to cancel one whose address can't be changed here, on that gift's row only", () => {
    held("cancel_only", "Needs an address", "first");
    const row = (title: string) => screen.getByText(title).closest("li")!;
    expect(row("Mug")).toHaveTextContent(/Needs an address.*has a link to cancel it/);
    expect(row("Vase")).toHaveTextContent("Waiting to order");
    expect(row("Vase")).not.toHaveTextContent(/address|cancel/);
  });

  it("offers the address only on the rows it's about", () => {
    held("change_address", "Needs an address", "first");
    expect(screen.getAllByRole("link", { name: "Change address" })).toHaveLength(1);
    expect(screen.getByText("Vase").closest("li")).toHaveTextContent("Waiting to order");
  });

  it("says a day that has passed was due", () => {
    const shown = (o: Partial<RoundPageOrder>) =>
      render(
        <RoundScreen
          view={view({ liveOrders: [order(o)] }, { status: "ordered", today: "2026-12-20" })}
          rejectAction={vi.fn()}
          setBudgetAction={vi.fn()}
          outlookAction={vi.fn()}
          arrivedAction={null}
          reactionsOpen={false}
        />,
      ).container;
    expect(shown({ estDeliveryDate: "2026-12-14" })).toHaveTextContent("Shipped · was due Mon, Dec 14");
    expect(shown({ estDeliveryDate: "2026-12-19" })).not.toHaveTextContent("May arrive");
    expect(shown({ status: "placed" })).not.toHaveTextContent("usually arrives");
  });
});

describe("RoundScreen: a failed gift's ways out (ALL-185)", () => {
  function withWaysOut(v: RoundPageView) {
    const pick = vi.fn(async (...a: [string, string]): Promise<PickAgainResult> => (void a, { ok: true }));
    const skip = vi.fn(async (...a: [string]): Promise<SkipResult> => (void a, { ok: true }));
    const ok = async () => ({ ok: true }) as const;
    render(
      <RoundScreen
        view={v}
        rejectAction={async () => ({ ok: true, more: true, saved: true })}
        setBudgetAction={ok}
        outlookAction={async () => OUTLOOK}
        arrivedAction={ok}
        reactionsOpen={false}
        waysOut={{ pick, skip }}
      />,
    );
    return { pick, skip };
  }

  it("Needs a fix offers Pick a different gift and Skip when it's the round's one gift", async () => {
    router.push.mockClear();
    const pad = idea({ title: "Mouse pad", status: "selected" });
    const failed = order({ id: "of1", ideaId: pad.id, title: "Mouse pad", status: "failed", failureType: "price_up" });
    const { pick } = withWaysOut(view({ ideas: [pad, idea({ title: "Switch" })], failedOrders: [failed] }, { status: "needs_attention" }));
    expect(screen.getByRole("link", { name: "Fix this" })).toBeInTheDocument();
    expect(screen.getByText("Drops the Mouse pad (it can't be bought again this time) and lets you choose from Mom's other ideas, or ask for new ones.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip Mom's birthday" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pick a different gift" }));
    expect(pick).toHaveBeenCalledWith("r1", "of1");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/rounds/r1"));
  });

  it("with two gifts to fix, only Skip is offered", () => {
    const a = order({ status: "failed", failureType: "price_up" });
    const b = order({ status: "failed", failureType: "out_of_stock" });
    withWaysOut(view({ failedOrders: [a, b] }, { status: "needs_attention" }));
    expect(screen.queryByRole("button", { name: "Pick a different gift" })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip Mom's birthday" })).toBeInTheDocument();
  });

  it("with a gift on its way, neither is offered", () => {
    const failed = order({ status: "failed", failureType: "out_of_stock" });
    withWaysOut(view({ failedOrders: [failed], liveOrders: [order({ status: "placed" })] }, { status: "needs_attention" }));
    expect(screen.queryByRole("button", { name: "Pick a different gift" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Skip/ })).toBeNull();
  });

  it("back to choosing, the dropped gift stays listed but can't be ticked, and the rest can", () => {
    const pad = idea({ title: "Mouse pad", status: "selected" });
    withWaysOut(view({ ideas: [pad, idea({ title: "Mug" })] }));
    expect(screen.getByRole("checkbox", { name: "Mouse pad" })).toBeDisabled();
    expect(screen.getByText("Couldn't be bought")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Mug" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "None of these" })).toBeInTheDocument();
  });
});
