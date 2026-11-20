// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProductPage } from "../../lib/page";
import { initialName, initialPrice, ProductCard, photoCandidates } from "../ProductCard";

const shot = new Blob([new Uint8Array([1])], { type: "image/png" });
function makePage(over: Partial<ProductPage> = {}, product: Partial<ProductPage["product"]> = {}): ProductPage {
  return {
    product: {
      isProduct: true,
      name: "YETI Rambler 20 oz Tumbler",
      priceCents: 3500,
      imageUrl: "https://img.rei.com/main.jpg?w=600",
      productId: "SKU-1",
      canonicalUrl: null,
      ...product,
    },
    pageUrl: "https://www.rei.com/product/1",
    screenshot: shot,
    scale: 2,
    candidates: [
      { src: "https://img.rei.com/other.jpg", x: 0, y: 0, width: 400, height: 400 },
      { src: "https://img.rei.com/main.jpg", x: 10, y: 20, width: 200, height: 100 },
      { src: "https://img.rei.com/small.jpg", x: 500, y: 0, width: 150, height: 150 },
    ],
    viewportWidth: 1000,
    ...over,
  };
}

// The card with the state App keeps for it.
function Harness({ page, onAdd = () => {} }: { page: ProductPage; onAdd?: () => void }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [name, setName] = useState(initialName(page));
  const [price, setPrice] = useState(initialPrice(page));
  return (
    <ProductCard
      page={page}
      photoIndex={photoIndex}
      onPhotoIndex={setPhotoIndex}
      name={name}
      onName={setName}
      price={price}
      onPrice={setPrice}
      busy={false}
      onAdd={onAdd}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:shot"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProductCard", () => {
  it("fills in the name, price and store, with the product photo first", async () => {
    const onAdd = vi.fn();
    render(<Harness page={makePage()} onAdd={onAdd} />);
    expect(screen.getByLabelText("Name")).toHaveValue("YETI Rambler 20 oz Tumbler");
    expect(screen.getByLabelText("Price")).toHaveValue("$35.00");
    expect(screen.getByText("rei.com")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    // The product image's box (10,20 200×100) is shown first, from the screenshot.
    const photo = screen.getByRole("img", { name: "Product photo" });
    expect(photo.style.backgroundImage).toContain("blob:shot");
    expect(photo.style.backgroundPosition).toBe("-5.6px -11.2px");
    await userEvent.click(screen.getByRole("button", { name: "Add to my list" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("‹ and › step through the photos and wrap around", async () => {
    render(<Harness page={makePage()} />);
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });

  it("no photo on screen: says No photo and Add still works", () => {
    render(<Harness page={makePage({ screenshot: null, scale: null, candidates: [] })} />);
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to my list" })).toBeEnabled();
  });

  it("one photo: no arrows and no count", () => {
    const page = makePage();
    render(<Harness page={{ ...page, candidates: page.candidates.slice(0, 1) }} />);
    expect(screen.getByRole("img", { name: "Product photo" })).toBeInTheDocument();
    expect(screen.queryByText("1 of 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
  });

  it("no price: the box is empty and focused with the hint, and Add is off until a price is typed", async () => {
    render(<Harness page={makePage({}, { priceCents: null })} />);
    const price = screen.getByLabelText("Price");
    expect(price).toHaveValue("");
    expect(price).toHaveFocus();
    expect(price).toHaveAccessibleDescription("Not on the page. Type it in.");
    const add = screen.getByRole("button", { name: "Add to my list" });
    expect(add).toBeDisabled();
    await userEvent.type(price, "abc");
    expect(add).toBeDisabled();
    await userEvent.clear(price);
    await userEvent.type(price, "24.99");
    expect(add).toBeEnabled();
  });

  it("an empty name turns Add off", async () => {
    render(<Harness page={makePage()} />);
    await userEvent.clear(screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Add to my list" })).toBeDisabled();
  });

  it("cuts a name over 300 characters to 300 when it fills in", () => {
    const page = makePage({}, { name: "x".repeat(350) });
    expect(initialName(page)).toHaveLength(300);
    render(<Harness page={page} />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxlength", "300");
  });

  it("photoCandidates orders by the product image, and is empty without a screenshot", () => {
    expect(photoCandidates(makePage()).map((b) => b.src)).toEqual([
      "https://img.rei.com/main.jpg",
      "https://img.rei.com/other.jpg",
      "https://img.rei.com/small.jpg",
    ]);
    expect(photoCandidates(makePage({ scale: null }))).toEqual([]);
  });
});
