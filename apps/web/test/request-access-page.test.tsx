import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: vi.fn() }));
const { RequestAccessForm } = await import("@/app/request-access/request-access-form");

describe("request access form (ALL-47)", () => {
  it("asks for just a name and an email, with an optional note", () => {
    render(<RequestAccessForm />);
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText(/Anything we should know\?/)).not.toBeRequired();
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
  });

  it("hides the bot trap from people and screen readers", () => {
    const { container } = render(<RequestAccessForm />);
    const trap = container.querySelector('input[name="website"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
