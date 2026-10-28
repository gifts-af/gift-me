import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AddGiftPanel from "../add-gift-panel.jsx";

// The details, image URL included, sit behind "Add by hand" (mock-up "list").
function openDetails() {
  render(<AddGiftPanel onAdd={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Add by hand" }));
}

function fireLoad(img, naturalWidth) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: naturalWidth });
  fireEvent.load(img);
}

describe("AddGiftPanel image preview", () => {
  it("renders the preview when a real image loads", () => {
    openDetails();
    fireEvent.change(screen.getByLabelText(/Image URL/), {
      target: { value: "https://example.com/photo.jpg" },
    });
    const img = screen.getByAltText("Preview of the gift image");
    fireLoad(img, 500);
    expect(screen.getByAltText("Preview of the gift image")).toBeInTheDocument();
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
  });

  it('falls back to "n/a" when the preview image is a 1x1 placeholder', () => {
    openDetails();
    fireEvent.change(screen.getByLabelText(/Image URL/), {
      target: { value: "https://images-na.ssl-images-amazon.com/images/P/B0DQLXWNTT.01._SCLZZZZZZZ_.jpg" },
    });
    const img = screen.getByAltText("Preview of the gift image");
    fireLoad(img, 1);
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.queryByAltText("Preview of the gift image")).not.toBeInTheDocument();
  });

  it('falls back to "n/a" when the preview image errors', () => {
    openDetails();
    fireEvent.change(screen.getByLabelText(/Image URL/), {
      target: { value: "https://example.com/broken.jpg" },
    });
    fireEvent.error(screen.getByAltText("Preview of the gift image"));
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });

  it("renders nothing when the image URL is empty", () => {
    openDetails();
    expect(screen.queryByAltText("Preview of the gift image")).not.toBeInTheDocument();
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
  });
});
