import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ViewDialog from "../view-dialog.jsx";

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});

describe("ViewDialog (ALL-10)", () => {
  it("names the store the gift is from", () => {
    const gift = { name: "Rice", productUrl: "https://www.target.com/p/rice/-/A-1" };
    render(<ViewDialog gift={gift} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /Open on target\.com, and I’ll claim it/ })).toBeInTheDocument();
  });

  it("still says Amazon for an Amazon gift", () => {
    const gift = { name: "Socks", productUrl: "https://www.amazon.com/dp/B0EXAMPLE1" };
    render(<ViewDialog gift={gift} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /Open on Amazon, and I’ll claim it/ })).toBeInTheDocument();
  });
});
