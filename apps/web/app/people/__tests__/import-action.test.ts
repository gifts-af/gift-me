import { beforeEach, describe, expect, it, vi } from "vitest";

// ALL-24: the import checklist's server action. The row checks are the real
// ones; the save is faked.
const importPeople = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
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
  });

  it("saves the checked rows and refreshes Home", async () => {
    importPeople.mockResolvedValue({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
    expect(await importContactsAction(null, form([good]))).toEqual({ ok: true, added: 1, skipped: 0, failed: 0, photosMissed: 0 });
    expect(importPeople).toHaveBeenCalledWith([expect.objectContaining({ googleId: "people/c1", name: "Sam" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
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
});
