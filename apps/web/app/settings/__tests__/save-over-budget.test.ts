import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, saveConciergeSettings } = vi.hoisted(() => ({ revalidatePath: vi.fn(), saveConciergeSettings: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/modules/concierge", () => ({ saveConciergeSettings }));
vi.mock("../zinc-deps", () => ({ placeHeld: vi.fn(), zincWiring: vi.fn() }));

import { saveOverBudget } from "../actions";

beforeEach(() => vi.clearAllMocks());

describe("saveOverBudget", () => {
  it("saves and revalidates Settings and the over-budget page", async () => {
    saveConciergeSettings.mockResolvedValue({ ok: true });
    expect(await saveOverBudget("15")).toEqual({ ok: true });
    expect(saveConciergeSettings).toHaveBeenCalledWith({ overBudgetPct: "15" });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/over-budget");
  });

  it("passes an error through without revalidating", async () => {
    saveConciergeSettings.mockResolvedValue({ ok: false, error: "nope" });
    expect(await saveOverBudget("abc")).toEqual({ ok: false, error: "nope" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
