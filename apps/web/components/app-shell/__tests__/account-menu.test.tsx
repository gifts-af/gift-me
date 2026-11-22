import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onBeforeLeaving } from "@/lib/leaving-page";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
const { AccountMenu } = await import("../account-menu");

// Moved down from e2e/top-bar.spec.ts (ALL-118): the menu's items are the
// component's job; the browser tests still open it and sign out through it.
const STORE = "https://chromewebstore.google.com/detail/giftsaf/abc";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it("offers the Chrome extension on desktop Chrome", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(DESKTOP_CHROME);
    render(<AccountMenu email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const item = await screen.findByRole("menuitem", { name: "Get the Chrome extension" });
    expect(item).toHaveAttribute("href", STORE);
    expect(item).toHaveAttribute("target", "_blank");
  });

  it("leaves the extension out where it can't be installed", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_STORE_URL", STORE);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    render(<AccountMenu email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await screen.findByRole("menuitem", { name: "Settings" });
    expect(screen.queryByRole("menuitem", { name: /extension/i })).not.toBeInTheDocument();
  });
});
