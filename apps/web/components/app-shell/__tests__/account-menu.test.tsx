import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountMenu } from "../account-menu";

// Moved down from e2e/top-bar.spec.ts (ALL-118): the menu's items are the
// component's job; the browser tests still open it and sign out through it.
describe("AccountMenu", () => {
  it("opens to Settings and Sign out", async () => {
    render(<AccountMenu email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
  });
});
