import { beforeEach, describe, expect, it, vi } from "vitest";

// "Looks right" on a ✨ fact (ALL-127, AC-10). The database write itself is
// covered for real by e2e/what-we-know.spec.ts.

const confirmFact = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("../notes-tip", () => ({ scheduleNotesTip: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/wiring", () => ({ placeHeld: async () => {} }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 20 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ client: true }) }));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/profile/rules")>("@/modules/concierge/profile/rules");
  return { confirmFact, isId: rules.isId };
});

import { confirmFactAction } from "../actions";

const FACT = "0b6f8f2e-3c1a-4d8e-9a57-2f1c0e9b7a11";
const PERSON = "6a1d3c7e-5b2f-4e9a-8c10-7d3e2f1a0b9c";

const form = (id: string) => {
  const f = new FormData();
  f.set("id", id);
  f.set("personId", PERSON);
  return f;
};

describe("confirmFactAction", () => {
  beforeEach(() => {
    confirmFact.mockReset();
    revalidatePath.mockClear();
  });

  it("confirms the fact and refreshes the person's page", async () => {
    confirmFact.mockResolvedValue({ ok: true });
    expect(await confirmFactAction(null, form(FACT))).toEqual({ ok: true });
    expect(confirmFact).toHaveBeenCalledWith({ client: true }, FACT);
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON}`);
  });

  it("refuses something that isn't a fact id, without asking the database", async () => {
    const result = await confirmFactAction(null, form("not-an-id"));
    expect(result.ok).toBe(false);
    expect(confirmFact).not.toHaveBeenCalled();
  });

  it("passes on a failure, without refreshing", async () => {
    confirmFact.mockResolvedValue({ ok: false, error: "That didn't go through. Try again." });
    expect(await confirmFactAction(null, form(FACT))).toEqual({ ok: false, error: "That didn't go through. Try again." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
