import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftCard from "../gift-card.jsx";

const baseGift = {
  id: "g1",
  name: "Sony WH-1000XM4",
  priceCents: 34800,
  imageUrl: "https://images-na.ssl-images-amazon.com/images/P/B0863TXGM3.01._SCLZZZZZZZ_.jpg",
  productUrl: "https://amazon.com/dp/B0863TXGM3",
  asin: "B0863TXGM3",
  source: "amazon-fixture",
  addedAt: 0,
};

// jsdom never fetches the image, so naturalWidth is always 0 by default.
// Spoof it before firing load to simulate what the browser reports.
function fireLoad(img, naturalWidth) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: naturalWidth });
  fireEvent.load(img);
}

describe("GiftCard image handling", () => {
  it("keeps the image when it loads at a real size", () => {
    render(<GiftCard gift={baseGift} onRemove={() => {}} />);
    const img = screen.getByRole("presentation", { hidden: true });
    fireLoad(img, 500);
    expect(screen.getByRole("presentation", { hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("No image")).not.toBeInTheDocument();
  });

  it('shows "No image" when the image loads as a 1x1 placeholder', () => {
    render(<GiftCard gift={baseGift} onRemove={() => {}} />);
    const img = screen.getByRole("presentation", { hidden: true });
    fireLoad(img, 1);
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.queryByRole("presentation", { hidden: true })).not.toBeInTheDocument();
  });

  it('shows "No image" when the image errors', () => {
    render(<GiftCard gift={baseGift} onRemove={() => {}} />);
    fireEvent.error(screen.getByRole("presentation", { hidden: true }));
    expect(screen.getByText("No image")).toBeInTheDocument();
  });

  it('shows "No image" from the start when imageUrl is null', () => {
    render(<GiftCard gift={{ ...baseGift, imageUrl: null }} onRemove={() => {}} />);
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.queryByRole("presentation", { hidden: true })).not.toBeInTheDocument();
  });

  it("calls onRemove with the gift id", () => {
    const onRemove = vi.fn();
    render(<GiftCard gift={baseGift} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove Sony WH-1000XM4/ }));
    expect(onRemove).toHaveBeenCalledWith("g1");
  });
});
