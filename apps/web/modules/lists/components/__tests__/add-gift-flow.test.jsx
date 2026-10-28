import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddGiftPanel from "../add-gift-panel.jsx";

async function lookUp(url) {
  const onAdd = vi.fn();
  render(<AddGiftPanel onAdd={onAdd} />);
  await userEvent.type(screen.getByLabelText("Paste an Amazon link"), url);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  return onAdd;
}

describe("adding a gift", () => {
  it("shows a full match as a card to confirm, then adds it", async () => {
    const onAdd = await lookUp("https://www.amazon.com/dp/B07FZ8S74R");
    await screen.findByText(/Echo Dot \(3rd Gen\)/);
    expect(screen.getByText(/\$39\.99 · found on Amazon/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 3999, asin: "B07FZ8S74R", source: "amazon-fixture" }),
    );
    expect(screen.getByLabelText("Paste an Amazon link")).toHaveValue("");
  });

  it("opens the details at the price when the link has no price", async () => {
    await lookUp("https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1");
    await waitFor(() => expect(screen.getByLabelText("Price")).toHaveFocus());
    expect(screen.getByLabelText("Gift name")).toHaveValue("Wool Hiking Socks");
  });

  it("keeps the link and says so when it can't be read", async () => {
    await lookUp("https://example.com/not-amazon");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Paste an Amazon link")).toHaveValue("https://example.com/not-amazon");
    expect(screen.getByLabelText("Paste an Amazon link")).toHaveFocus();
  });

  it("checks the price when adding by hand", async () => {
    const onAdd = vi.fn();
    render(<AddGiftPanel onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    await userEvent.type(screen.getByLabelText("Gift name"), "Concert tickets");
    await userEvent.type(screen.getByLabelText("Price"), "12.5.0");
    await userEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.getByText("Enter a price like 24.99.")).toBeInTheDocument();
    expect(screen.getByLabelText("Price")).toHaveAttribute("aria-invalid", "true");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("focuses the name as soon as the details open, never later", () => {
    render(<AddGiftPanel onAdd={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    // Focus must land in the same update; a delayed focus would pull a fast
    // typist out of the field they'd already moved to.
    expect(screen.getByLabelText("Gift name")).toHaveFocus();
  });
});
