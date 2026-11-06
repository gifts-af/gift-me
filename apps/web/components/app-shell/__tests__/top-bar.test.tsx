import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductTabs } from "../product-tabs";
import { BackLink } from "../page-frame";
import { TopBar } from "../top-bar";

describe("TopBar", () => {
  it("shows the logo linking to / and, with nothing else, the sun/moon", async () => {
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "GiftsAF" })).toHaveAttribute("href", "/");
    expect(await screen.findByRole("button", { name: /Switch to/ })).toBeInTheDocument();
  });

  it("keeps the logo when something fills the slot", () => {
    render(
      <TopBar>
        <button>Account</button>
      </TopBar>,
    );
    expect(screen.getByRole("link", { name: "GiftsAF" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});

describe("ProductTabs", () => {
  it("links Get to the list and Give to people", () => {
    render(<ProductTabs />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get" })).toHaveAttribute("href", "/lists");
    expect(screen.getByRole("link", { name: "Give" })).toHaveAttribute("href", "/");
  });

  it.each([
    ["get", "Get", "Give"],
    ["give", "Give", "Get"],
  ] as const)("marks only the current one on %s", (current, on, off) => {
    render(<ProductTabs current={current} />);
    expect(screen.getByRole("link", { name: on })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: off })).not.toHaveAttribute("aria-current");
  });

  it("marks neither on a page outside both", () => {
    render(<ProductTabs />);
    expect(screen.getByRole("link", { name: "Get" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Give" })).not.toHaveAttribute("aria-current");
  });
});

describe("BackLink", () => {
  it("links to where it says", () => {
    render(<BackLink href="/people/1" label="Jim" />);
    expect(screen.getByRole("link", { name: "Jim" })).toHaveAttribute("href", "/people/1");
  });
});
