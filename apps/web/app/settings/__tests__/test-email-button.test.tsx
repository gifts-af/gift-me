import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestEmailButton } from "../test-email-button";

describe("TestEmailButton", () => {
  it("shows Sending… while pending, then the success text", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    const action = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<TestEmailButton action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Send me a test email" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    finish({ ok: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Sent. Check your inbox.");
    expect(screen.getByRole("button", { name: "Send me a test email" })).toBeEnabled();
  });

  it("shows the error when sending fails", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "We couldn't send it. Try again in a minute." });
    render(<TestEmailButton action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Send me a test email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't send it. Try again in a minute.");
  });
});
