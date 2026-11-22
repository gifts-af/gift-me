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
const buyingWiring = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wiring", () => ({ placeHeld: async () => {}, placeAddressHeld: async () => {}, buyingWiring }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 20 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const renamePerson = vi.hoisted(() => vi.fn());
const setRelationship = vi.hoisted(() => vi.fn());
const setBirthYear = vi.hoisted(() => vi.fn());
const setDatedOccasion = vi.hoisted(() => vi.fn());
const removeDatedOccasion = vi.hoisted(() => vi.fn());
const saveAddress = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/people/rules")>("@/modules/concierge/people/rules");
  return {
    deletePerson, addPerson, renamePerson, setRelationship, setBirthYear, setDatedOccasion, removeDatedOccasion, saveAddress,
    parsePersonForm: rules.parsePersonForm, parseMonthDay: rules.parseMonthDay, parseBirthYear: rules.parseBirthYear,
    parseAddressForm: rules.parseAddressForm,
  };
});

import {
  addPersonAction,
  deletePersonAction,
  removeDatedOccasionAction,
  renamePersonAction,
  saveAddressAction,
  setBirthYearAction,
  setDatedOccasionAction,
  setRelationshipAction,
} from "../actions";

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

  it("passes the list link's token on, and none without one (ALL-123)", async () => {
    addPerson.mockResolvedValue({ ok: true, id: "p1" });
    const f = person();
    f.set("list", "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46");
    await addPersonAction(null, f);
    expect(addPerson).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Dad" }), "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46");
    await addPersonAction(null, person());
    expect(addPerson).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Dad" }), undefined);
  });

  it("returns the already-added person's id unchanged", async () => {
    const existing = { ok: false, error: "Sam is already in your people.", existingId: "p0" };
    addPerson.mockResolvedValue(existing);
    expect(await addPersonAction(null, person())).toEqual(existing);
  });

  it("sends no tip when adding failed", async () => {
    addPerson.mockResolvedValue({ ok: false, error: "nope" });
    await addPersonAction(null, person());
    expect(scheduleNotesTip).not.toHaveBeenCalled();
  });
});

// About's fields (ALL-127): each action saves one field, refreshes the pages
// that show it, and never builds the buying wiring.
describe("one field at a time", () => {
  const ID = "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46";
  beforeEach(() => {
    for (const fn of [renamePerson, setRelationship, setBirthYear, setDatedOccasion, removeDatedOccasion]) {
      fn.mockReset();
      fn.mockResolvedValue({ ok: true });
    }
    buyingWiring.mockClear();
    revalidatePath.mockClear();
  });

  it("renames, and refreshes Home and the person's pages", async () => {
    expect(await renamePersonAction(ID, "Mama")).toEqual({ ok: true });
    expect(renamePerson).toHaveBeenCalledWith(ID, "Mama");
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(["/", "/people", `/people/${ID}`]));
  });

  it("sets the relationship", async () => {
    expect(await setRelationshipAction(ID, "aunt")).toEqual({ ok: true });
    expect(setRelationship).toHaveBeenCalledWith(ID, "aunt");
  });

  it("sets a date from the month and day picked", async () => {
    expect(await setDatedOccasionAction(ID, "birthday", "11", "30")).toEqual({ ok: true });
    expect(setDatedOccasion).toHaveBeenCalledWith(ID, "birthday", { month: 11, day: 30 });
  });

  it("refuses a date that doesn't exist, or cleared fields, without saving", async () => {
    const bad = { ok: false, error: "That date doesn't exist." };
    expect(await setDatedOccasionAction(ID, "birthday", "2", "31")).toEqual(bad);
    expect(await setDatedOccasionAction(ID, "anniversary", "6", "")).toEqual(bad);
    // Cleared fields never come from About (it doesn't send them): a bad form.
    expect(await setDatedOccasionAction(ID, "anniversary", "", "")).toEqual({
      ok: false,
      error: "That didn't go through. Reload and try again.",
    });
    expect(setDatedOccasion).not.toHaveBeenCalled();
  });

  it("sets the birth year from its text; empty clears it", async () => {
    await setBirthYearAction(ID, "1960");
    await setBirthYearAction(ID, " ");
    expect(setBirthYear.mock.calls).toEqual([[ID, 1960, 2026], [ID, null, 2026]]);
    expect(await setBirthYearAction(ID, "19x0")).toEqual({ ok: false, error: "Enter a birth year between 1900 and this year." });
    expect(setBirthYear).toHaveBeenCalledTimes(2);
  });

  it("removes a birthday or anniversary", async () => {
    await removeDatedOccasionAction(ID, "birthday");
    await removeDatedOccasionAction(ID, "anniversary");
    expect(removeDatedOccasion.mock.calls).toEqual([[ID, "birthday"], [ID, "anniversary"]]);
  });

  it("refuses anything that isn't a birthday or anniversary, or isn't text", async () => {
    const badForm = { ok: false, error: "That didn't go through. Reload and try again." };
    expect(await setDatedOccasionAction(ID, "christmas", "12", "25")).toEqual(badForm);
    expect(await removeDatedOccasionAction(ID, "christmas")).toEqual(badForm);
    expect(await renamePersonAction(ID, 5 as unknown as string)).toEqual(badForm);
    expect(await setRelationshipAction({} as unknown as string, "aunt")).toEqual(badForm);
    expect(setDatedOccasion).not.toHaveBeenCalled();
    expect(removeDatedOccasion).not.toHaveBeenCalled();
    expect(renamePerson).not.toHaveBeenCalled();
    expect(setRelationship).not.toHaveBeenCalled();
  });

  it("doesn't refresh anything when the save fails", async () => {
    renamePerson.mockResolvedValue({ ok: false, error: "nope" });
    expect(await renamePersonAction(ID, "Mama")).toEqual({ ok: false, error: "nope" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never builds the buying wiring", async () => {
    await renamePersonAction(ID, "Mama");
    await setRelationshipAction(ID, "aunt");
    await setDatedOccasionAction(ID, "birthday", "11", "30");
    await setBirthYearAction(ID, "1960");
    await removeDatedOccasionAction(ID, "birthday");
    expect(buyingWiring).not.toHaveBeenCalled();
  });
});

// ALL-27: a saved address no longer moves rounds on; the next daily tick finds ideas for them.
describe("saveAddressAction", () => {
  it("saves the address and builds no round engine, so no idea run starts", async () => {
    saveAddress.mockResolvedValue({ ok: true });
    buyingWiring.mockClear();
    const f = new FormData();
    for (const [k, v] of Object.entries({
      id: "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46",
      firstName: "Rita",
      lastName: "Engine",
      line1: "1 Test Street",
      city: "Portland",
      state: "OR",
      zip: "97201",
      country: "US",
    })) {
      f.set(k, v);
    }
    expect(await saveAddressAction(null, f)).toEqual({ ok: true });
    expect(saveAddress).toHaveBeenCalledWith("3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46", expect.anything(), {
      placeAddressHeld: expect.any(Function),
    });
    expect(buyingWiring).not.toHaveBeenCalled();
  });
});
