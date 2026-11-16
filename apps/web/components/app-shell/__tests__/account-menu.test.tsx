import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { onBeforeLeaving } from "@/lib/leaving-page";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const { AccountMenu } = await import("../account-menu");

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

  // My list sends a remove held for Undo before the session goes (ALL-127).
  it("waits for a page's work still on its way before signing out", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    let finish!: () => void;
    const stop = onBeforeLeaving(() => new Promise<void>((r) => (finish = r)));
    render(<AccountMenu email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(signOut).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login"));
    expect(signOut).toHaveBeenCalled();
    stop();
    vi.restoreAllMocks();
  });
});
