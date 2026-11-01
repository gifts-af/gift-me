import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "../logo";

describe("Logo (ALL-48)", () => {
  it("reads as the platform name", () => {
    render(<Logo />);
    expect(screen.getByRole("img", { name: "GiftsAF" })).toBeInTheDocument();
  });

  it("shows Gifts as text and AF on the tag", () => {
    const { container } = render(<Logo />);
    expect(container).toHaveTextContent("Gifts");
    expect(container.querySelector('[data-part="tag"]')).not.toBeNull();
    expect(container.querySelector('[data-part="af"]')).not.toBeNull();
  });

  it("carries a hat that stays hidden unless the page is in holiday mode", () => {
    const { container } = render(<Logo />);
    const hat = container.querySelector('[data-part="hat"]');
    expect(hat).not.toBeNull();
    expect(hat).toHaveClass("hidden");
    expect(hat?.getAttribute("class")).toContain("[html[data-holiday]_&]:inline");
  });
});
