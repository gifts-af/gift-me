import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonDetail } from "@/modules/concierge";
import { Occasions } from "../occasions";

type Row = PersonDetail["occasions"][number];

const christmas: Row = {
  kind: "christmas", enabled: true, date: "2026-12-25", orderBy: { date: "2026-12-16", fast: false }, budgetCents: null,
};

function setup(rows: Row[], result: { ok: true } | { ok: false; error: string } = { ok: true }) {
  const action = vi.fn(async (...a: [unknown, FormData]) => (void a, result));
  render(<Occasions personId="p1" occasions={rows} action={action} />);
  return action;
}

describe("Occasions", () => {
  it("shows the next date and the normal order-by date", () => {
    setup([christmas]);
    expect(screen.getByText("Fri, Dec 25")).toBeInTheDocument();
    expect(screen.getByText("Order by Wed, Dec 16")).toBeInTheDocument();
  });

  it("says when fast shipping is needed", () => {
    setup([{ ...christmas, orderBy: { date: "2026-12-22", fast: true } }]);
    expect(screen.getByText("Order by Tue, Dec 22 with fast shipping")).toBeInTheDocument();
  });

  it("says when it is too late to ship", () => {
    setup([{ ...christmas, orderBy: null }]);
    expect(screen.getByText("Too late to ship")).toBeInTheDocument();
  });

  it("shows no order-by line for a switched-off occasion", () => {
    setup([{ ...christmas, enabled: false, orderBy: null }]);
    expect(screen.queryByText(/Order by|Too late/)).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Christmas" })).not.toBeChecked();
  });

  it("calls the action with the person, the kind and the new setting", async () => {
    const action = setup([christmas]);
    await userEvent.click(screen.getByRole("switch", { name: "Christmas" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const form = action.mock.calls[0][1];
    expect(form.get("id")).toBe("p1");
    expect(form.get("kind")).toBe("christmas");
    expect(form.get("enabled")).toBe("false");
  });

  it("puts the switch back and shows the error when it fails", async () => {
    setup([christmas], { ok: false, error: "That couldn't be saved. Try again." });
    await userEvent.click(screen.getByRole("switch", { name: "Christmas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That couldn't be saved. Try again.");
    expect(screen.getByRole("switch", { name: "Christmas" })).toBeChecked();
  });
});
