import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PastGift, PastRound } from "@/modules/concierge";
import { PastGifts } from "../gifts/past-gifts";

const gift = (o: Partial<PastGift> = {}): PastGift => ({
  orderId: "o1",
  title: "Cozy blanket",
  totalCents: 4218,
  outcome: "delivered",
  deliveredAt: "2026-03-12T10:00:00Z",
  refundCents: null,
  rating: null,
  note: null,
  ...o,
});
const round = (o: Partial<PastRound> = {}): PastRound => ({
  roundId: "r1",
  occasionKind: "birthday",
  occasionDate: "2026-03-14",
  status: "delivered",
  gifts: [gift()],
  ...o,
});
const show = (rounds: PastRound[], o: { today?: string; canAnswer?: boolean } = {}) =>
  render(<PastGifts name="Nora" rounds={rounds} today={o.today ?? "2026-11-24"} canAnswer={o.canAnswer ?? true} />);

describe("PastGifts", () => {
  it("lists the rounds in the order given, each with its occasion and full date", () => {
    show([
      round(),
      round({ roundId: "r2", occasionKind: "christmas", occasionDate: "2025-12-25" }),
      round({ roundId: "r3", occasionKind: null, occasionDate: "2025-03-14" }),
    ]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Birthday · Sat, Mar 14, 2026",
      "Christmas · Thu, Dec 25, 2025",
      "Occasion · Fri, Mar 14, 2025",
    ]);
  });

  it("a gift with an answer: cost, delivery, answer, note and Change", () => {
    show([round({ gifts: [gift({ rating: "loved", note: "So soft\n<b>really</b>" })] })]);
    const item = within(screen.getByRole("listitem"));
    for (const text of ["Cozy blanket", "$42.18", "Delivered Thu, Mar 12", "Loved it"]) expect(item.getByText(text)).toBeInTheDocument();
    expect(item.getByText(/So soft/).textContent).toBe("So soft\n<b>really</b>");
    expect(item.getByRole("link", { name: "Change how Cozy blanket went" })).toHaveAttribute("href", "/rounds/r1/reaction?gift=o1");
    expect(item.queryByText(/back in Zinc/)).toBeNull();
  });

  it("a gift without one asks how it went", () => {
    show([round()]);
    const link = screen.getByRole("link", { name: "How did it go? Cozy blanket" });
    expect(link).toHaveAttribute("href", "/rounds/r1/reaction?gift=o1");
    expect(link).toHaveTextContent("How did it go?");
  });

  it.each<[string, Partial<PastGift>, string]>([
    ["no delivery date", { deliveredAt: null }, "Delivered"],
    ["still on its way", { outcome: "on_its_way" }, "Ordered, not marked as delivered"],
    ["not confirmed", { outcome: "being_bought" }, "Order not confirmed"],
    ["failed", { outcome: "not_bought" }, "Not bought"],
    ["cancelled, refund known", { outcome: "store_cancelled", refundCents: 4050 }, "The store cancelled it · $40.50 back in Zinc"],
    ["cancelled, refund not said", { outcome: "store_cancelled" }, "The store cancelled it · the money is back in Zinc"],
  ])("%s", (_, o, text) => {
    show([round({ gifts: [gift(o)] })]);
    expect(screen.getByText(text)).toBeInTheDocument();
    if (o.outcome) expect(screen.queryByRole("link")).toBeNull();
  });

  it("says when the cost isn't known yet, but not of a gift that was never bought", () => {
    show([round({ gifts: [gift({ totalCents: null }), gift({ orderId: "o2", outcome: "not_bought", totalCents: null })] })]);
    expect(screen.getAllByText("Cost not known yet")).toHaveLength(1);
  });

  it("only a skipped round says no gift was bought", () => {
    const { unmount } = show([round({ status: "skipped", gifts: [] })]);
    expect(screen.getByText("No gift was bought.")).toBeInTheDocument();
    unmount();
    show([round({ gifts: [] }), round({ roundId: "r2", status: "skipped", gifts: [gift({ outcome: "store_cancelled" })] })]);
    expect(screen.queryByText("No gift was bought.")).toBeNull();
  });

  it.each([
    ["the occasion is still to come", { today: "2026-03-13" }],
    ["answers are switched off", { canAnswer: false }],
  ])("asks nothing while %s", (_, o) => {
    show([round()], o);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so when there's nothing yet", () => {
    show([]);
    expect(screen.getByText("No past gifts for Nora yet.")).toBeInTheDocument();
  });
});
