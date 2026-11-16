import { beforeEach, describe, expect, it, vi } from "vitest";

const deletePerson = vi.hoisted(() => vi.fn());
const addPerson = vi.hoisted(() => vi.fn());
const scheduleNotesTip = vi.hoisted(() => vi.fn());
vi.mock("../notes-tip", () => ({ scheduleNotesTip }));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
// The Zinc wiring is server-only glue; these tests never place an order.
vi.mock("@/app/settings/zinc-deps", () => ({ placeHeld: async () => {} }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 20 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/people/rules")>("@/modules/concierge/people/rules");
  return { deletePerson, addPerson, parsePersonForm: rules.parsePersonForm };
});

import { addPersonAction, deletePersonAction } from "../actions";

const form = (id: string) => {
  const f = new FormData();
  f.set("id", id);
  return f;
};

describe("deletePersonAction", () => {
  beforeEach(() => {
    deletePerson.mockReset();
    revalidatePath.mockClear();
    redirect.mockClear();
  });

  it("revalidates Home, never the deleted person's page, and redirects Home", async () => {
    deletePerson.mockResolvedValue({ ok: true });
    await expect(deletePersonAction(null, form("p1"))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/");
    expect(paths).not.toContain("/people/p1");
  });

  it("returns the error and stays put when deleting fails", async () => {
    deletePerson.mockResolvedValue({ ok: false, error: "nope" });
    expect(await deletePersonAction(null, form("p1"))).toEqual({ ok: false, error: "nope" });
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("addPersonAction (AC-15)", () => {
  const person = () => {
    const f = new FormData();
    f.set("name", "Dad");
    f.set("relationship", "father");
    return f;
  };
  beforeEach(() => {
    addPerson.mockReset();
    scheduleNotesTip.mockReset();
  });

  it("schedules the tip for the new person", async () => {
    addPerson.mockResolvedValue({ ok: true, id: "p1" });
    expect(await addPersonAction(null, person())).toEqual({ ok: true, id: "p1" });
    expect(scheduleNotesTip).toHaveBeenCalledWith({ id: "p1", name: "Dad" });
  });

  it("still succeeds when the tip throws", async () => {
    addPerson.mockResolvedValue({ ok: true, id: "p1" });
    scheduleNotesTip.mockRejectedValue(new Error("boom"));
    expect(await addPersonAction(null, person())).toEqual({ ok: true, id: "p1" });
  });

  it("sends no tip when adding failed", async () => {
    addPerson.mockResolvedValue({ ok: false, error: "nope" });
    await addPersonAction(null, person());
    expect(scheduleNotesTip).not.toHaveBeenCalled();
  });
});
