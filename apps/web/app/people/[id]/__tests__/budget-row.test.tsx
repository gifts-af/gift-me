import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PersonDetail } from "@/modules/concierge";
import { BudgetRow, budgetSummary } from "../budget-row";

// The Budget row on a person's page (ALL-120, T71): its value, and a link to the Budget screen.

type Occasion = PersonDetail["occasions"][number];
const occasion = (o: Partial<Occasion>): Occasion => ({
  kind: "christmas", enabled: true, date: "2026-12-25", orderBy: null, budgetCents: null, ...o,
});

describe("budgetSummary", () => {
  it("says Not set with nothing at all", () => {
    expect(budgetSummary(null, null, [occasion({})])).toBe("Not set");
  });

  it("shows the base alone", () => {
    expect(budgetSummary(7500, null, [occasion({})])).toBe("$75");
  });

  it("shows the base, then occasions with their own amounts", () => {
    expect(
      budgetSummary(7500, null, [occasion({}), occasion({ kind: "mothers_day", date: "2027-05-09", budgetCents: 5000 })]),
    ).toBe("$75 · Mother's Day $50");
  });

  it("lists occasion amounts without a base, leaving out switched-off ones", () => {
    expect(
      budgetSummary(null, null, [
        occasion({ budgetCents: 10000 }),
        occasion({ kind: "mothers_day", budgetCents: 5050 }),
        occasion({ kind: "birthday", enabled: false, budgetCents: 4000 }),
      ]),
    ).toBe("Christmas $100 · Mother's Day $50.50");
  });

  it("shows the relationship default when there's no base", () => {
    expect(budgetSummary(null, 6000, [occasion({})])).toBe("$60 default");
  });
});

describe("BudgetRow", () => {
  it("is a link to the Budget screen showing its value", () => {
    render(<BudgetRow personId="p1" baseCents={7500} defaultCents={null} occasions={[occasion({})]} />);
    const link = screen.getByRole("link", { name: /Budget/ });
    expect(link).toHaveAttribute("href", "/people/p1/budget");
    expect(link).toHaveTextContent("$75");
  });
});
