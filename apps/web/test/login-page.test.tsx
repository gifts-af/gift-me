import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRequestHref } from "@/lib/brand";

vi.mock("@/components/login-form", () => ({ LoginForm: () => <form aria-label="Sign in form" /> }));
const { default: LoginPage } = await import("@/app/auth/login/page");

describe("sign-in page (ALL-46)", () => {
  it("says GiftsAF is invite only and offers a way to ask", () => {
    render(<LoginPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />);
    expect(screen.getByText(/GiftsAF is invite only for now\./)).toBeInTheDocument();
    const ask = screen.getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", accessRequestHref());
    // A 44 px tap target, like every other link (ui.md).
    expect(ask).toHaveClass("min-h-11");
  });
});
