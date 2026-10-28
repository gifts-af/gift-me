import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsForm } from "../settings-form";

const initial = { timezone: "America/New_York", overBudgetPct: 15 };

describe("SettingsForm", () => {
  it("shows the saved values", () => {
    render(<SettingsForm initial={initial} action={vi.fn()} />);
    expect(screen.getByLabelText("Time zone")).toHaveValue("America/New_York");
    expect(screen.getByLabelText(/Over-budget allowance/)).toHaveValue("15");
  });

  it("says Saved after a successful save", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<SettingsForm initial={initial} action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(action.mock.calls[0][1].get("overBudgetPct")).toBe("15");
  });

  it("shows the error when saving fails", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Enter a whole number from 0 to 100." });
    render(<SettingsForm initial={initial} action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a whole number from 0 to 100.");
  });

  it("keeps what was typed after a failed save, so it can be corrected", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Enter a whole number from 0 to 100." });
    render(<SettingsForm initial={initial} action={action} />);
    const input = screen.getByLabelText(/Over-budget allowance/);
    await userEvent.clear(input);
    await userEvent.type(input, "101");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("101");
  });

  it("sends what was typed, even after an earlier failed save", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Enter a whole number from 0 to 100." })
      .mockResolvedValueOnce({ ok: true });
    render(<SettingsForm initial={initial} action={action} />);
    const input = screen.getByLabelText(/Over-budget allowance/);
    await userEvent.clear(input);
    await userEvent.type(input, "101");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await userEvent.clear(input);
    await userEvent.type(input, "20");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("status");
    expect(action.mock.calls[1][1].get("overBudgetPct")).toBe("20");
  });

  it("suggests the device's time zone when none is saved", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    render(<SettingsForm initial={{ ...initial, timezone: null }} action={vi.fn()} />);
    expect(screen.getByLabelText("Time zone")).toHaveValue(zone);
  });
});
