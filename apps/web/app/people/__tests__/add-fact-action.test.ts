import { beforeEach, describe, expect, it, vi } from "vitest";

// "Add something" on What we know (ALL-186). The database write itself is covered for real by
// modules/concierge/__tests__/add-fact-db.test.ts and e2e/what-we-know.spec.ts.

const addFact = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("../notes-tip", () => ({ scheduleNotesTip: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/wiring", () => ({ placeHeld: async () => {} }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 20 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ client: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/profile/rules")>("@/modules/concierge/profile/rules");
  return { addFact, isId: rules.isId, parseFactEdit: rules.parseFactEdit, SENSITIVE_REFUSAL: rules.SENSITIVE_REFUSAL };
});

import { SENSITIVE_REFUSAL } from "@/modules/concierge";
import { addFactAction } from "../actions";

const PERSON = "6a1d3c7e-5b2f-4e9a-8c10-7d3e2f1a0b9c";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ personId: PERSON, category: "interest", value: "pottery", ...fields })) f.set(k, v);
  return f;
};

describe("addFactAction", () => {
  beforeEach(() => {
    addFact.mockReset();
    revalidatePath.mockClear();
  });

  it("saves the tidied words with the kind, and refreshes the person's page and What we know", async () => {
    addFact.mockResolvedValue({ ok: true });
    expect(await addFactAction(null, form({ value: "  size   M tops ", category: "size" }))).toEqual({ ok: true });
    expect(addFact).toHaveBeenCalledWith({ client: true }, PERSON, { category: "size", value: "size M tops" });
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON}/know`);
  });

  it("refuses something that isn't a person id, without asking the database", async () => {
    expect(await addFactAction(null, form({ personId: "not-an-id" }))).toEqual({
      ok: false,
      error: "That didn't go through. Reload and try again.",
    });
    expect(addFact).not.toHaveBeenCalled();
  });

  it.each([
    ["a sensitive fact", { value: "goes to church" }, SENSITIVE_REFUSAL],
    ["empty words", { value: "   " }, "Type something first."],
    ["an unknown kind", { category: "mood" }, "That didn't go through. Reload and try again."],
  ])("refuses %s, saving nothing", async (_, fields, error) => {
    expect(await addFactAction(null, form(fields))).toEqual({ ok: false, error });
    expect(addFact).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes on a failure, without refreshing", async () => {
    addFact.mockResolvedValue({ ok: false, error: "That's already on their profile." });
    expect(await addFactAction(null, form({}))).toEqual({ ok: false, error: "That's already on their profile." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
