import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: vi.fn() }));
const { RequestAccessForm } = await import("@/app/request-access/request-access-form");
const { default: RequestAccessPage, metadata } = await import("@/app/request-access/page");

describe("request access form (ALL-47)", () => {
  it("asks for the concierge, says nothing of invites, and has no alpha banner", () => {
    const { container } = render(<RequestAccessPage />);
    expect(container).toHaveTextContent("Gift ideas, reminders and buying come with the concierge.");
    expect(container).not.toHaveTextContent(/invite/i);
    expect(`${metadata.title} ${metadata.description}`).not.toMatch(/invite/i);
    expect(screen.getByRole("heading", { level: 1, name: "Request concierge access" })).toBeInTheDocument();
    expect(screen.queryByText(/Lots is broken/)).not.toBeInTheDocument();
  });

  it("asks for just a name and an email, with an optional note", () => {
    render(<RequestAccessForm />);
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText(/Anything we should know\?/)).not.toBeRequired();
    expect(screen.getByRole("button", { name: "Request concierge access" })).toBeInTheDocument();
  });

  it("hides the bot trap from people and screen readers", () => {
    const { container } = render(<RequestAccessForm />);
    const trap = container.querySelector('input[name="website"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
