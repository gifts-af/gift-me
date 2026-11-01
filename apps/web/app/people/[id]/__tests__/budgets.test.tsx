import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonDetail } from "@/modules/concierge";
import { Budgets } from "../budgets";

type Row = PersonDetail["occasions"][number];
const row = (o: Partial<Row>): Row => ({
  kind: "christmas", enabled: true, date: "2026-12-25", orderBy: null, budgetCents: null, ...o,
});

// Mirrors the real action's answer to a bad amount.
const action = vi.fn(async (_p: unknown, form: FormData) => {
  const amount = String(form.get("budget")).trim();
  return amount === "" || /^\$?\d+(\.\d{1,2})?$/.test(amount)
    ? ({ ok: true } as const)
    : ({ ok: false, error: "Enter an amount like 75 or 75.50." } as const);
});

function setup(rows: Row[]) {
  action.mockClear();
  render(<Budgets personId="p1" occasions={rows} action={action} />);
}

describe("Budgets", () => {
  it("says it is optional and private", () => {
    setup([row({})]);
    expect(screen.getByText("Optional. Only you see it.")).toBeInTheDocument();
  });

  it("shows Not set when empty and the amount when set", () => {
    setup([row({}), row({ kind: "birthday", budgetCents: 7500 }), row({ kind: "anniversary", budgetCents: 7550 })]);
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("$75")).toBeInTheDocument();
    expect(screen.getByText("$75.50")).toBeInTheDocument();
  });

  it("shows a row only for enabled occasions", () => {
    setup([row({}), row({ kind: "birthday", enabled: false })]);
    expect(screen.getByText("Christmas")).toBeInTheDocument();
    expect(screen.queryByText("Birthday")).not.toBeInTheDocument();
  });

  it("sends the person, kind and typed amount", async () => {
    setup([row({})]);
    await userEvent.click(screen.getByRole("button", { name: "Set Christmas budget" }));
    await userEvent.type(screen.getByLabelText("Christmas budget"), "$75");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const form = action.mock.calls[0][1];
    expect([form.get("id"), form.get("kind"), form.get("budget")]).toEqual(["p1", "christmas", "$75"]);
    await waitFor(() => expect(screen.queryByLabelText("Christmas budget")).not.toBeInTheDocument());
  });

  it("shows an error for abc and keeps the field open", async () => {
    setup([row({})]);
    await userEvent.click(screen.getByRole("button", { name: "Set Christmas budget" }));
    await userEvent.type(screen.getByLabelText("Christmas budget"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an amount like 75 or 75.50.");
    expect(screen.getByLabelText("Christmas budget")).toBeInTheDocument();
  });

  it("starts the field with the saved amount", async () => {
    setup([row({ budgetCents: 7550 })]);
    await userEvent.click(screen.getByRole("button", { name: "Edit Christmas budget" }));
    expect(screen.getByLabelText("Christmas budget")).toHaveValue("75.50");
  });
});
