import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonDetail } from "@/modules/concierge";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { BudgetForm, type BudgetsResult } from "../budget-form";

// The Budget screen's form (ALL-120). The action is faked; the real one is
// covered by the service tests, pgTAP and e2e/people.spec.ts.

type Occasion = PersonDetail["occasions"][number];
const occasion = (o: Partial<Occasion>): Occasion => ({
  kind: "christmas", enabled: true, date: "2026-12-25", orderBy: null, budgetCents: null, ...o,
});
const OCCASIONS = [occasion({}), occasion({ kind: "mothers_day", date: "2027-05-09", budgetCents: 5000 })];

function setup({
  base = 7500 as number | null,
  defaultCents = null as number | null,
  action = vi.fn(async (...a: [unknown, FormData]): Promise<BudgetsResult> => (void a, { ok: true })),
} = {}) {
  push.mockClear();
  render(<BudgetForm personId="p1" name="Mom" baseCents={base} defaultCents={defaultCents} occasions={OCCASIONS} action={action} />);
  return { action };
}

describe("BudgetForm", () => {
  it("shows the base, each occasion, the placeholders and the note", () => {
    setup();
    expect(screen.getByLabelText("Any occasion")).toHaveValue("75");
    expect(screen.getByText("What you usually spend on Mom.")).toBeInTheDocument();
    expect(screen.getByLabelText("Christmas")).toHaveValue("");
    expect(screen.getByLabelText("Christmas")).toHaveAttribute("placeholder", "Uses $75");
    expect(screen.getByLabelText("Mother's Day")).toHaveValue("50");
    expect(
      screen.getByText("Leave an occasion empty to use the amount above. Rounds already started keep their budget."),
    ).toBeInTheDocument();
  });

  it("uses the relationship default in the placeholder when there's no base", () => {
    setup({ base: null, defaultCents: 6000 });
    expect(screen.getByLabelText("Christmas")).toHaveAttribute("placeholder", "Uses $60");
  });

  it("sends the person, the base and every occasion shown, then goes back to the person", async () => {
    const { action } = setup();
    await userEvent.clear(screen.getByLabelText("Mother's Day"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const form = action.mock.calls[0][1];
    expect([form.get("id"), form.get("any"), form.get("christmas"), form.get("mothers_day")]).toEqual(["p1", "75", "", ""]);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/people/p1"));
  });

  it("shows each field's message by that field and keeps what was typed", async () => {
    setup({
      action: vi.fn(async (): Promise<BudgetsResult> => ({ ok: false, errors: { christmas: "Enter an amount like 75 or 75.50." } })),
    });
    await userEvent.type(screen.getByLabelText("Christmas"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter an amount like 75 or 75.50.")).toBeInTheDocument();
    expect(screen.getByLabelText("Christmas")).toHaveValue("abc");
    expect(screen.getByLabelText("Christmas")).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
  });

  it("says to try again when the save can't reach the server", async () => {
    setup({ action: vi.fn(async (): Promise<BudgetsResult> => Promise.reject(new Error("offline"))) });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  });

  it("saves once even when Save is tapped twice", async () => {
    let finish: (r: BudgetsResult) => void = () => {};
    const action = vi.fn(() => new Promise<BudgetsResult>((resolve) => (finish = resolve)));
    setup({ action });
    const button = screen.getByRole("button", { name: "Save" });
    await userEvent.click(button);
    await userEvent.click(button);
    await act(async () => finish({ ok: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
