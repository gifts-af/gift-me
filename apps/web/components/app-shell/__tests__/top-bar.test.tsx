import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "../top-bar";

describe("TopBar", () => {
  it("shows the name linking Home when there's no back link", () => {
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "GiftMe" })).toHaveAttribute("href", "/");
  });

  it("shows a back link with its label instead of the name", () => {
    render(<TopBar back={{ href: "/", label: "Home" }} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "GiftMe" })).not.toBeInTheDocument();
  });

  it("marks the current product in the links", () => {
    render(<TopBar links current="list" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My list" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "People" })).not.toHaveAttribute("aria-current");
  });

  it("renders the actions and account slots", () => {
    render(<TopBar actions={<button>Share</button>} account={<button>Account</button>} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
