import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { OverBudgetField } from "../over-budget-field";

const field = () => screen.getByRole("textbox", { name: /over-budget allowance/i });
const type = (value: string) => fireEvent.change(field(), { target: { value } });

describe("OverBudgetField", () => {
  it("saves a change on blur, once", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<OverBudgetField initial={10} action={action} />);
    type("15");
    await act(async () => fireEvent.blur(field()));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("15");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("saves on Enter, then does not send again on blur", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<OverBudgetField initial={10} action={action} />);
    type("15");
    await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
    await act(async () => fireEvent.blur(field()));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not call the action when nothing changed", async () => {
    const action = vi.fn();
    render(<OverBudgetField initial={10} action={action} />);
    await act(async () => fireEvent.blur(field()));
    expect(action).not.toHaveBeenCalled();
  });

  it("shows the action's error and keeps what was typed", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Enter a whole number." });
    render(<OverBudgetField initial={10} action={action} />);
    type("abc");
    await act(async () => fireEvent.blur(field()));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number.");
    expect(field()).toHaveValue("abc");
  });

  it("saves an unsaved change when it unmounts", () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(<OverBudgetField initial={10} action={action} />);
    type("15");
    unmount();
    expect(action).toHaveBeenCalledWith("15");
  });

  it("sends once when blur is followed by unmount", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { unmount } = render(<OverBudgetField initial={10} action={action} />);
    type("15");
    await act(async () => fireEvent.blur(field()));
    unmount();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
