import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Outcome, type BuyResult } from "../outcome";

// What the confirm and fix pages say after Buy. The result's gifts come from the real rows in
// purchase.test.ts and replace.test.ts.

type Gift = Exclude<NonNullable<Extract<BuyResult, { ok: true }>["gifts"]>, "unknown">[number];
let n = 0;
const gift = (title: string, status: Gift["status"], reason: string | null = null): Gift => ({ orderId: `o${++n}`, title, status, reason });

function show(gifts: Gift[] | "unknown" | undefined, status: "ordered" | "held" | "failed", reason: string | null) {
  render(<Outcome result={{ ok: true, status, reason, ...(gifts ? { gifts } : {}) }} roundId="r1" />);
  return screen.getByRole("status");
}
const row = (title: string) => within(screen.getByText(title).closest("li")!);

describe("Outcome with several gifts", () => {
  it("ordered + failed: names both, and never says the whole purchase failed", () => {
    const panel = show([gift("Fly reel", "failed", "out_of_stock"), gift("Tote", "ordered")], "failed", "out_of_stock");
    expect(within(panel).getByText("1 of 2 gifts ordered")).toBeInTheDocument();
    expect(row("Fly reel").getByText("It's out of stock")).toBeInTheDocument();
    expect(row("Fly reel").getByText("We didn't buy it. We've emailed you what you can do.")).toBeInTheDocument();
    expect(row("Tote").getByText("Ordered")).toBeInTheDocument();
    expect(row("Tote").queryByText(/didn't buy it/)).toBeNull();
  });

  it("ordered + held: the held one says what it waits on", () => {
    show([gift("Tote", "ordered"), gift("Fly reel", "held", "funds")], "held", "funds");
    expect(screen.getByText("1 of 2 gifts ordered")).toBeInTheDocument();
    expect(row("Fly reel").getByText("Waiting on your Zinc balance")).toBeInTheDocument();
    expect(row("Tote").getByText("Ordered")).toBeInTheDocument();
  });

  it("failed + held: each with its own reason, though the round has only one", () => {
    show([gift("Fly reel", "failed", "too_late"), gift("Tote", "held", "retry")], "failed", "retry");
    expect(screen.getByText("No gifts ordered yet")).toBeInTheDocument();
    expect(row("Fly reel").getByText("It can't arrive in time")).toBeInTheDocument();
    expect(row("Tote").getByText("Not ordered yet")).toBeInTheDocument();
  });

  it("two failed: both named, each with its own reason", () => {
    show([gift("Fly reel", "failed", "out_of_stock"), gift("Fly box", "failed", "price_up")], "failed", "price_up");
    expect(screen.getByText("No gifts ordered yet")).toBeInTheDocument();
    expect(row("Fly reel").getByText("It's out of stock")).toBeInTheDocument();
    expect(row("Fly box").getByText("Price went up")).toBeInTheDocument();
  });

  it("unconfirmed + ordered: the unconfirmed one isn't called ordered", () => {
    show([gift("Fly reel", "held", "unconfirmed"), gift("Tote", "ordered")], "held", "unconfirmed");
    // It may have been ordered too, so there's no count.
    expect(screen.getByText("What happened with your gifts")).toBeInTheDocument();
    expect(row("Fly reel").getByText("Waiting on Zinc")).toBeInTheDocument();
  });

  it("unconfirmed + failed: doesn't say nothing was ordered, since it may have been", () => {
    show([gift("Fly reel", "held", "unconfirmed"), gift("Tote", "failed", "out_of_stock")], "failed", "unconfirmed");
    expect(screen.getByText("What happened with your gifts")).toBeInTheDocument();
    expect(screen.queryByText("No gifts ordered yet")).toBeNull();
  });

  it("an address failure says so, not that the store refused the order", () => {
    show([gift("Fly reel", "failed", "address_withdrawn"), gift("Tote", "ordered")], "failed", "failed");
    expect(row("Fly reel").getByText("The address isn't shared any more")).toBeInTheDocument();
  });

  it("a gift already shipped or delivered isn't pointed to delivery updates", () => {
    show([gift("Mug", "ordered", "delivered"), gift("Vase", "ordered", "shipped"), gift("Tote", "failed", "out_of_stock")], "failed", "out_of_stock");
    expect(screen.getByText("2 of 3 gifts ordered")).toBeInTheDocument();
    expect(row("Mug").getByText("Delivered")).toBeInTheDocument();
    expect(row("Vase").getByText("Shipped")).toBeInTheDocument();
    expect(screen.queryByText(/delivery updates/)).toBeNull();
  });

  it("a store cancel gets the neutral heading too: it was ordered once", () => {
    show([gift("Fly reel", "failed", "store_cancelled"), gift("Tote", "ordered")], "failed", "failed");
    expect(screen.getByText("What happened with your gifts")).toBeInTheDocument();
  });

  it("only the gift the round's reason is about says we've emailed; the others point to the gift's page", () => {
    show([gift("Fly reel", "held", "funds"), gift("Tote", "failed", "out_of_stock")], "failed", "unconfirmed");
    expect(screen.queryByText(/We've emailed/)).toBeNull();
    expect(row("Fly reel").getByText("Add money to your Zinc balance and we'll order it.")).toBeInTheDocument();
    expect(row("Tote").getByText("We didn't buy it. See what you can do on the gift's page.")).toBeInTheDocument();
  });

  it("a hold that is the round's reason says we've emailed how", () => {
    show([gift("Fly reel", "held", "funds"), gift("Tote", "ordered")], "held", "funds");
    expect(row("Fly reel").getByText("Add money to your Zinc balance and we'll order it. We've emailed you how.")).toBeInTheDocument();
  });

  it.each(["unconfirmed", "retry"])("a gift to try again beside an unconfirmed one isn't promised shortly (round reason %s)", (reason) => {
    show([gift("Fly reel", "held", "unconfirmed"), gift("Tote", "held", "retry")], "held", reason);
    expect(screen.queryByText(/try again shortly/)).toBeNull();
    expect(row("Tote").getByText("See what happens next on the gift's page.")).toBeInTheDocument();
  });

  it("when what happened to each couldn't be read, says neither reason nor outcome", () => {
    const panel = show("unknown", "failed", "out_of_stock");
    expect(panel).toHaveTextContent("What happened with your gifts");
    expect(panel).toHaveTextContent("See each one on the gift's page.");
    expect(panel).not.toHaveTextContent(/stock|didn't buy/);
    expect(screen.getByRole("link", { name: "Back to the gift" })).toBeInTheDocument();
  });

  it("goes back to the gift when anything was ordered or is held, and to the ideas when nothing was", () => {
    show([gift("Fly reel", "failed", "out_of_stock"), gift("Tote", "ordered")], "failed", "out_of_stock");
    expect(screen.getByRole("link")).toHaveTextContent("Back to the gift");
  });
  it("all failed: See all ideas", () => {
    show([gift("Fly reel", "failed", "out_of_stock"), gift("Tote", "failed", "too_late")], "failed", "out_of_stock");
    expect(screen.getByRole("link")).toHaveTextContent("See all ideas");
  });
  it("one held: Back to the gift", () => {
    show(undefined, "held", "funds");
    expect(screen.getByRole("link")).toHaveTextContent("Back to the gift");
  });

  it("one gift reads as it always has", () => {
    const panel = show(undefined, "failed", "out_of_stock");
    expect(panel).toHaveTextContent(/^It's out of stockWe didn't buy it\. We've emailed you what you can do\.$/);
  });
});

describe("Outcome for a card buyer", () => {
  const refused = (error: "no_card" | "connect_off") => {
    render(<Outcome result={{ ok: false, error }} roundId="r1" />);
    return screen.getByRole("status");
  };

  it("AC-12: paused says buying is paused and nothing was bought, never a Zinc word", () => {
    expect(refused("connect_off")).toHaveTextContent(
      /^Buying is pausedWe can't buy gifts right now\. Nothing was bought\. We'll email you when it's back on\.$/,
    );
  });

  it("AC-6: no card says to add one, and that adding one buys nothing", () => {
    expect(refused("no_card")).toHaveTextContent(
      /^Add a card firstNothing was bought\. Add a card, then tap Buy again\. Adding a card doesn't buy anything\.$/,
    );
  });

  it("AC-6: a declined card at placing says nothing was bought", () => {
    const panel = show(undefined, "failed", "card_needed");
    expect(panel).toHaveTextContent(/^Your card changed or couldn't be chargedNothing was bought\. We've emailed you what you can do\.$/);
    expect(panel).not.toHaveTextContent(/Zinc|store couldn't/);
  });
});
