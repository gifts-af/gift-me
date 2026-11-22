import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AddGiftPanel from "../add-gift-panel";

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

const STORE = "https://chromewebstore.google.com/detail/giftsaf/abc";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

describe("AddGiftPanel extension hint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("points desktop Chrome to the extension", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(DESKTOP_CHROME);
    render(<AddGiftPanel onAdd={() => {}} />);
    expect(await screen.findByText(/Shopping elsewhere\?/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /save from any shop with the extension/i });
    expect(link).toHaveAttribute("href", STORE);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("says nothing where the extension can't be installed", () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_CHROME);
    render(<AddGiftPanel onAdd={() => {}} />);
    expect(screen.queryByText(/Shopping elsewhere\?/)).not.toBeInTheDocument();
  });

  it("steps aside while a gift is being added", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(DESKTOP_CHROME);
    render(<AddGiftPanel onAdd={() => {}} />);
    await screen.findByText(/Shopping elsewhere\?/);
    fireEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    expect(screen.queryByText(/Shopping elsewhere\?/)).not.toBeInTheDocument();
  });
});
