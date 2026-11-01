import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ALL-74: a light/dark switch everyone can reach, signed in or not. The theme
// itself lives in next-themes (shared with the account menu), faked here.
const themes = vi.hoisted(() => ({ resolvedTheme: "light", setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => themes }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

const { ThemeToggle } = await import("../theme-toggle");
const { HomeTopBar } = await import("../home/home-top-bar");
const { AuthFrame } = await import("../auth-frame");
const { TopBar } = await import("../app-shell/top-bar");

beforeEach(() => {
  themes.resolvedTheme = "light";
  themes.setTheme.mockReset();
});

describe("ThemeToggle", () => {
  it("offers dark when the page is light, and switches to it", async () => {
    render(<ThemeToggle />);
    const button = await screen.findByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(themes.setTheme).toHaveBeenCalledWith("dark");
  });

  it("offers light when the page is dark, whatever made it dark", async () => {
    themes.resolvedTheme = "dark";
    render(<ThemeToggle />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to light mode" }));
    expect(themes.setTheme).toHaveBeenCalledWith("light");
  });

  it("is a big enough tap target", async () => {
    render(<ThemeToggle />);
    expect(await screen.findByRole("button", { name: /Switch to/ })).toHaveClass("size-11");
  });
});

describe("where it shows", () => {
  it("is in the home and tour top bar", async () => {
    render(<HomeTopBar />);
    expect(await screen.findByRole("button", { name: /Switch to/ })).toBeInTheDocument();
  });

  it("is on the sign-in screens", async () => {
    render(<AuthFrame>form</AuthFrame>);
    expect(await screen.findByRole("button", { name: /Switch to/ })).toBeInTheDocument();
  });

  it("is in the app bar for signed-out visitors (shared lists), not beside the account menu", async () => {
    const { unmount } = render(<TopBar />);
    expect(await screen.findByRole("button", { name: /Switch to/ })).toBeInTheDocument();
    unmount();
    await act(async () => {
      render(<TopBar account={<span>account</span>} />);
    });
    expect(screen.queryByRole("button", { name: /Switch to/ })).not.toBeInTheDocument();
  });
});
