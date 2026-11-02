import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopBar } from "@/components/app-shell/top-bar";
import { AuthFrame } from "@/components/auth-frame";
import { HomeTopBar } from "@/components/home/home-top-bar";

// ALL-48: the wordmark replaces the plain-text name in every top bar.
function logoInHomeLink() {
  const home = screen.getByRole("link", { name: /GiftsAF/ });
  expect(home).toHaveAttribute("href", "/");
  expect(within(home).getByRole("img", { name: "GiftsAF" })).toBeInTheDocument();
}

describe("where the logo shows", () => {
  it("is in the app's top bar", () => {
    render(<TopBar />);
    logoInHomeLink();
  });

  it("is in the home page and tour top bar, next to the ALPHA tag", () => {
    render(<HomeTopBar />);
    logoInHomeLink();
    expect(screen.getByText("ALPHA")).toBeInTheDocument();
  });

  it("heads the sign-in pages", () => {
    render(<AuthFrame>form</AuthFrame>);
    expect(screen.getByRole("heading", { level: 1 })).toContainElement(screen.getByRole("img", { name: "GiftsAF" }));
    logoInHomeLink();
  });

  it("leaves a sign-in page's own title as text", () => {
    render(<AuthFrame title="Reset your password">form</AuthFrame>);
    expect(screen.getByRole("heading", { level: 1, name: "Reset your password" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "GiftsAF" })).not.toBeInTheDocument();
  });
});
