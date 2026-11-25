import { beforeEach, describe, expect, it, vi } from "vitest";

// ALL-24: the import checklist's server action. The row checks are the real
// ones; the save is faked.
const importPeople = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
// The Zinc wiring is server-only glue; these tests never place an order.
vi.mock("@/lib/wiring", () => ({ placeHeld: async () => {} }));
const appSettingInt = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/app-settings", () => ({ appSettingInt }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const scheduleNotesTip = vi.hoisted(() => vi.fn());
vi.mock("../notes-tip", () => ({ scheduleNotesTip }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/people/rules")>("@/modules/concierge/people/rules");
  return { importPeople, parseImportRows: rules.parseImportRows };
});

import { importContactsAction } from "../actions";

const form = (rows: unknown) => {
  const f = new FormData();
  f.set("rows", typeof rows === "string" ? rows : JSON.stringify(rows));
  return f;
};
const good = { googleId: "people/c1", name: "Sam", relationship: "friend" };

describe("importContactsAction", () => {
  beforeEach(() => {
    importPeople.mockReset();
    revalidatePath.mockClear();
    scheduleNotesTip.mockReset();
    appSettingInt.mockResolvedValue(1);
  });

  it.each([
    ["is off", () => appSettingInt.mockResolvedValue(0)],
    ["can't be read", () => appSettingInt.mockRejectedValue(new Error("boom"))],
  ])("saves nothing when the Google import switch %s (AC-15)", async (_what, arrange) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    arrange();
    expect(await importContactsAction(null, form([good]))).toEqual({
      ok: false,
      error: "Google import is off for now. Add people by hand.",
    });
    expect(appSettingInt).toHaveBeenCalledWith("google_import_enabled");
    expect(importPeople).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("saves the checked rows and refreshes Home", async () => {
    importPeople.mockResolvedValue({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
    expect(await importContactsAction(null, form([good]))).toEqual({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
    expect(importPeople).toHaveBeenCalledWith([expect.objectContaining({ googleId: "people/c1", name: "Sam" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/give");
  });

  it("counts rows the checks refused as failed (AC-10)", async () => {
    importPeople.mockResolvedValue({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
    const result = await importContactsAction(null, form([good, { ...good, googleId: "people/c2", relationship: "nemesis" }]));
    expect(result).toMatchObject({ added: 1, failed: 1 });
    expect(importPeople.mock.calls[0][0]).toHaveLength(1);
  });

  it("saves nothing for a form that isn't a list of rows", async () => {
    expect(await importContactsAction(null, form("nope"))).toEqual({ ok: false, error: "Nothing to import. Try again." });
    expect(importPeople).not.toHaveBeenCalled();
  });

  it("tips about the first person added, not the result's extra field (AC-15)", async () => {
    importPeople.mockResolvedValue({ ok: true, added: 2, skipped: 0, failed: 0, photosMissed: 0, firstAdded: { id: "p1", name: "Sam" } });
    const result = await importContactsAction(null, form([good]));
    expect(scheduleNotesTip).toHaveBeenCalledWith({ id: "p1", name: "Sam" });
    expect(result).toEqual({ ok: true, added: 2, skipped: 0, failed: 0, photosMissed: 0 });
  });

  it("sends no tip when nobody was added, and still succeeds when the tip throws", async () => {
    importPeople.mockResolvedValue({ ok: true, added: 0, skipped: 1, failed: 0, photosMissed: 0, firstAdded: null });
    await importContactsAction(null, form([good]));
    expect(scheduleNotesTip).not.toHaveBeenCalled();
    importPeople.mockResolvedValue({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0, firstAdded: { id: "p1", name: "Sam" } });
    scheduleNotesTip.mockRejectedValue(new Error("boom"));
    expect(await importContactsAction(null, form([good]))).toMatchObject({ ok: true, added: 1 });
  });
});
