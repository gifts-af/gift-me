import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// open-signup.spec.ts runs this against the real database.
const m = vi.hoisted(() => ({ readAccess: vi.fn(), settings: vi.fn(), payment: vi.fn(), wiring: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/components/concierge-gate", () => ({ readAccess: m.readAccess, AccessCheckFailed: () => <p>Refresh to try again.</p> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/wiring", () => ({ zincWiring: m.wiring }));
vi.mock("@/modules/concierge", () => ({ getConciergeSettings: m.settings, getPaymentSummary: m.payment }));

import { ConciergeGroups } from "../concierge-groups";

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ overBudgetPct: 20 });
  m.payment.mockRejectedValue(new Error("no Zinc here"));
  m.wiring.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const headings = () => screen.queryAllByRole("heading").map((h) => h.textContent);

describe("the concierge's groups on Settings (AC-7)", () => {
  it("show with access, even when the payment summary can't load", async () => {
    m.readAccess.mockResolvedValue({ access: true, requested: false });
    render(await ConciergeGroups());
    expect(headings()).toEqual(["Reminders", "Gift ideas", "Paying for gifts"]);
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it.each([
    ["without access", { access: false, requested: true }, null],
    ["when the check fails, with a retry line", null, "Refresh to try again."],
  ])("don't show, or load anything, %s", async (_, state, text) => {
    m.readAccess.mockResolvedValue(state);
    render(await ConciergeGroups());
    expect(headings()).toEqual([]);
    if (text) expect(screen.getByText(text)).toBeInTheDocument();
    for (const load of [m.settings, m.payment, m.wiring]) expect(load).not.toHaveBeenCalled();
  });
});
