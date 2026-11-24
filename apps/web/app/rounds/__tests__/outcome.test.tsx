import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Outcome, type BuyResult } from "../outcome";

// What the confirm and fix pages say after Buy. The result's gifts come from the real rows in
// purchase.test.ts and replace.test.ts.

type Gift = NonNullable<Extract<BuyResult, { ok: true }>["gifts"]>[number];
let n = 0;
const gift = (title: string, status: Gift["status"], reason: string | null = null): Gift => ({ orderId: `o${++n}`, title, status, reason });

function show(gifts: Gift[] | undefined, status: "ordered" | "held" | "failed", reason: string | null) {
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
    expect(screen.getByText("1 of 2 gifts ordered")).toBeInTheDocument();
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

  it("a gift already shipped or delivered isn't told it will be emailed about shipping", () => {
    show([gift("Mug", "ordered", "delivered"), gift("Vase", "ordered", "shipped"), gift("Tote", "failed", "out_of_stock")], "failed", "out_of_stock");
    expect(screen.getByText("2 of 3 gifts ordered")).toBeInTheDocument();
    expect(row("Mug").getByText("Delivered")).toBeInTheDocument();
    expect(row("Vase").getByText("Shipped")).toBeInTheDocument();
    expect(screen.queryByText(/when it ships/)).toBeNull();
  });

  it("one gift reads as it always has", () => {
    const panel = show(undefined, "failed", "out_of_stock");
    expect(panel).toHaveTextContent(/^It's out of stockWe didn't buy it\. We've emailed you what you can do\.$/);
  });
});
