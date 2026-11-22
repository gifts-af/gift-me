import { beforeEach, describe, expect, it, vi } from "vitest";

// buyAction's input checks (ALL-29 Task 12): malformed input is refused before the session or
// any money path is touched. The real action runs in the round journeys (Task 13).
const { createClient, approveAndBuy, quoteFailedOrder, buyingWiring, lookupWiring } = vi.hoisted(() => ({
  createClient: vi.fn(),
  approveAndBuy: vi.fn(),
  quoteFailedOrder: vi.fn(),
  buyingWiring: vi.fn(),
  lookupWiring: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/app/settings/zinc-deps", () => ({ buyingWiring, lookupWiring, roundDbDeps: vi.fn() }));
vi.mock("@/modules/concierge", () => ({ approveAndBuy, quoteFailedOrder, MAX_BUDGET_CENTS: 1 }));

import { buyAction, checkPriceAction } from "../actions";

const ROUND = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function form(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe("buyAction input", () => {
  it("refuses more than 50 ideas before reading the session", async () => {
    const ideas = Array.from({ length: 51 }, (_, i) => id(i + 2)).join(",");
    expect(await buyAction(ROUND, form({ ideas }))).toEqual({ ok: false, error: "bad_form" });
    expect(createClient).not.toHaveBeenCalled();
    expect(approveAndBuy).not.toHaveBeenCalled();
  });

  it("refuses a gift note over 2000 characters before reading the session", async () => {
    expect(await buyAction(ROUND, form({ ideas: id(2), note: "x".repeat(2001) }))).toEqual({ ok: false, error: "bad_form" });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("checkPriceAction", () => {
  it("with buying off here (no Zinc wiring) it says zinc_off and looks nothing up", async () => {
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } });
    buyingWiring.mockResolvedValue({ engine: {}, purchase: null });
    expect(await checkPriceAction(ROUND, id(2))).toEqual({ ok: false, error: "zinc_off" });
    expect(lookupWiring).not.toHaveBeenCalled();
    expect(quoteFailedOrder).not.toHaveBeenCalled();
  });
});
