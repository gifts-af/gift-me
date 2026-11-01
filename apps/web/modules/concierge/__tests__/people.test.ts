import { describe, expect, it, vi } from "vitest";
import {
  addPerson,
  deletePerson,
  getPerson,
  linkList,
  listPeople,
  setBudget,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  updatePerson,
} from "../people/service";
import type { PersonInput } from "../people/rules";
import { FakePeopleStore, ME, OTHER } from "./fake-people-store";

const TODAY = "2026-11-01";
const TOKEN = "3f2b8c1e-9d4a-4e6b-8a1f-0c5d7e9b2a46";
const NOT_FOUND = "That person wasn't found.";

const input = (over: Partial<PersonInput> = {}): PersonInput => ({
  name: "Mom",
  relationship: "mother",
  birthday: { month: 11, day: 20 },
  birthYear: 1960,
  anniversary: null,
  ...over,
});

function setup() {
  const store = new FakePeopleStore();
  const mine = store.seed(ME, { name: "Mine", relationship: "wife" }, [
    { kind: "birthday", month: 12, day: 1 },
    { kind: "christmas" },
    { kind: "anniversary", month: 6, day: 5 },
  ]);
  const theirs = store.seed(OTHER, { name: "Theirs" }, [{ kind: "birthday", month: 11, day: 3 }, { kind: "christmas" }]);
  return { store, mine, theirs };
}

describe("addPerson", () => {
  it("saves the person with the occasions their relationship implies and returns the id", async () => {
    const store = new FakePeopleStore();
    const result = await addPerson(store, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = store.occasionRows.filter((o) => o.personId === result.id).map((o) => o.kind);
    expect(kinds.sort()).toEqual(["birthday", "christmas", "mothers_day"]);
    expect(JSON.parse(store.writes[0].replace("createPerson ", ""))).toMatchObject({
      name: "Mom", relationship: "mother", birthYear: 1960, birthday: { month: 11, day: 20 },
    });
  });

  it("adds no birthday or anniversary without dates", async () => {
    const store = new FakePeopleStore();
    const result = await addPerson(store, input({ relationship: "wife", birthday: null, anniversary: null }));
    expect(result.ok).toBe(true);
    const kinds = store.occasionRows.map((o) => o.kind).sort();
    expect(kinds).toEqual(["christmas", "valentines_day"]);
  });

  it("returns an error when the database refuses", async () => {
    const store = new FakePeopleStore();
    store.createPerson = async () => {
      throw new Error("boom");
    };
    expect(await addPerson(store, input())).toEqual({
      ok: false,
      error: "That person couldn't be saved. Try again.",
    });
  });
});

describe("listPeople", () => {
  it("sorts by next occasion date, then name, with people who have none last", async () => {
    const store = new FakePeopleStore();
    store.seed(ME, { name: "Zed" }, [{ kind: "birthday", month: 11, day: 20 }]);
    store.seed(ME, { name: "Amy" }, [{ kind: "birthday", month: 11, day: 20 }]);
    store.seed(ME, { name: "Bob" }, [{ kind: "christmas" }]);
    store.seed(ME, { name: "Cy" }, [{ kind: "christmas", enabled: false }]);
    store.seed(ME, { name: "Abe" });
    store.seed(OTHER, { name: "Intruder" }, [{ kind: "birthday", month: 11, day: 2 }]);

    const cards = await listPeople(store, TODAY);
    expect(cards.map((c) => c.name)).toEqual(["Amy", "Zed", "Bob", "Abe", "Cy"]);
    expect(cards[0].next).toEqual({ kind: "birthday", date: "2026-11-20" });
    expect(cards[2].next).toEqual({ kind: "christmas", date: "2026-12-25" });
    expect(cards[3].next).toBeNull();
  });

  it("reports the card fields, signing photo paths", async () => {
    const store = new FakePeopleStore();
    store.seed(ME, { name: "Pic", photoPath: "me/p1/a.jpg", linkedUserId: "u2", relationship: "sister" }, [
      { kind: "birthday", month: 3, day: 3 },
    ]);
    store.seed(ME, { name: "NoPic" });
    const cards = await listPeople(store, TODAY);
    const pic = cards.find((c) => c.name === "Pic")!;
    expect(pic).toMatchObject({
      relationship: "sister", photoUrl: "https://signed.test/me/p1/a.jpg", keepsList: true, hasBirthday: true,
    });
    const none = cards.find((c) => c.name === "NoPic")!;
    expect(none).toMatchObject({ photoUrl: null, keepsList: false, hasBirthday: false });
    expect(store.signed).toEqual([["me/p1/a.jpg"]]);
  });

  it("drops an occasion from next when it is turned off", async () => {
    const { store, mine } = setup();
    expect((await listPeople(store, TODAY))[0].next).toEqual({ kind: "birthday", date: "2026-12-01" });
    expect(await setOccasionEnabled(store, mine, "birthday", false)).toEqual({ ok: true });
    expect((await listPeople(store, TODAY))[0].next).toEqual({ kind: "christmas", date: "2026-12-25" });
  });
});

describe("getPerson", () => {
  it("returns the detail with dates, order-by dates and budgets", async () => {
    const { store, mine } = setup();
    store.budgetRows.push({ personId: mine, kind: "christmas", cents: 7500 });
    store.rows.get(mine)!.birthYear = 1990;
    store.rows.get(mine)!.photoPath = `${ME}/${mine}/a.jpg`;
    const p = await getPerson(store, mine, TODAY);
    expect(p).toMatchObject({
      id: mine, photoPath: `${ME}/${mine}/a.jpg`, name: "Mine", birthYear: 1990, birthday: { month: 12, day: 1 }, anniversary: { month: 6, day: 5 },
    });
    const byKind = Object.fromEntries(p!.occasions.map((o) => [o.kind, o]));
    expect(byKind.christmas).toEqual({
      kind: "christmas", enabled: true, date: "2026-12-25", orderBy: { date: "2026-12-16", fast: false },
      budgetCents: 7500,
    });
    // 7 days + 2 buffer before 1 Dec is 22 Nov; still ahead.
    expect(byKind.birthday.orderBy).toEqual({ date: "2026-11-22", fast: false });
    expect(byKind.birthday.budgetCents).toBeNull();
    expect(p!.occasions.map((o) => o.kind)).toEqual([
      "birthday", "christmas", "valentines_day", "mothers_day", "anniversary", "fathers_day",
    ]);
  });

  it("uses the fast deadline when the normal one has passed, and null when too late", async () => {
    const store = new FakePeopleStore();
    const id = store.seed(ME, { name: "Late" }, [
      { kind: "birthday", month: 11, day: 8 }, // normal 30 Oct passed; fast 4 Nov
      { kind: "anniversary", month: 11, day: 2 }, // fast 29 Oct passed
    ]);
    const p = await getPerson(store, id, TODAY);
    const byKind = Object.fromEntries(p!.occasions.map((o) => [o.kind, o]));
    expect(byKind.birthday.orderBy).toEqual({ date: "2026-11-04", fast: true });
    expect(byKind.anniversary.orderBy).toBeNull();
  });

  it("has no order-by date for a switched-off occasion", async () => {
    const { store, mine } = setup();
    await setOccasionEnabled(store, mine, "christmas", false);
    const p = await getPerson(store, mine, TODAY);
    expect(p!.occasions.find((o) => o.kind === "christmas")).toMatchObject({ enabled: false, orderBy: null });
  });

  it("returns null for an id that is not a UUID, without asking the store", async () => {
    const { store } = setup();
    const spy = vi.spyOn(store, "person");
    expect(await getPerson(store, "abc", TODAY)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null for an unknown, deleted or someone else's person", async () => {
    const { store, mine, theirs } = setup();
    expect(await getPerson(store, "nope", TODAY)).toBeNull();
    expect(await getPerson(store, theirs, TODAY)).toBeNull();
    await deletePerson(store, mine);
    expect(await getPerson(store, mine, TODAY)).toBeNull();
  });
});

describe("a malformed id", () => {
  it("is a not-found error from a mutation, with no writes", async () => {
    const { store } = setup();
    expect(await setOccasionEnabled(store, "abc", "christmas", false)).toEqual({
      ok: false, error: "That person wasn't found.",
    });
    expect(store.writes).toEqual([]);
  });
});

describe("updatePerson", () => {
  it("changes the details and moves the birthday, leaving other switches alone", async () => {
    const { store, mine } = setup();
    await setOccasionEnabled(store, mine, "christmas", false);
    const result = await updatePerson(
      store,
      mine,
      input({ name: "New", relationship: "wife", birthday: { month: 1, day: 9 }, anniversary: { month: 6, day: 5 } }),
    );
    expect(result).toEqual({ ok: true });
    expect(store.rows.get(mine)).toMatchObject({ name: "New", birthYear: 1960 });
    const occ = store.occasionRows.filter((o) => o.personId === mine);
    expect(occ.find((o) => o.kind === "birthday")).toMatchObject({ month: 1, day: 9, enabled: true });
    expect(occ.find((o) => o.kind === "christmas")!.enabled).toBe(false);
    expect(occ.find((o) => o.kind === "anniversary")).toMatchObject({ month: 6, day: 5 });
  });

  it("removes the birthday and anniversary when cleared", async () => {
    const { store, mine } = setup();
    await updatePerson(store, mine, input({ birthday: null, anniversary: null }));
    expect(store.occasionRows.filter((o) => o.personId === mine).map((o) => o.kind)).toEqual(["christmas"]);
  });

  it("adds a birthday later, enabled", async () => {
    const store = new FakePeopleStore();
    const id = store.seed(ME, { name: "Pat" }, [{ kind: "christmas" }]);
    await updatePerson(store, id, input({ birthday: { month: 4, day: 2 } }));
    expect(store.occasionRows.find((o) => o.kind === "birthday")).toMatchObject({
      personId: id, month: 4, day: 2, enabled: true,
    });
  });

  it("does not touch occasions that already match", async () => {
    const { store, mine } = setup();
    await updatePerson(store, mine, input({ birthday: { month: 12, day: 1 }, anniversary: { month: 6, day: 5 } }));
    expect(store.writes).toEqual([`updatePerson ${mine}`]);
  });
});

describe("setBudget", () => {
  it("stores an amount, then null when cleared", async () => {
    const { store, mine } = setup();
    expect(await setBudget(store, mine, "christmas", 7500)).toEqual({ ok: true });
    expect(store.budgetRows).toEqual([{ personId: mine, kind: "christmas", cents: 7500 }]);
    expect(await setBudget(store, mine, "christmas", null)).toEqual({ ok: true });
    expect(store.budgetRows).toEqual([{ personId: mine, kind: "christmas", cents: null }]);
  });

  it("refuses amounts above the database's integer limit", async () => {
    const { store, mine } = setup();
    expect(await setBudget(store, mine, "christmas", 2147483648)).toEqual({
      ok: false,
      error: "That amount is too large.",
    });
    expect(await setBudget(store, mine, "christmas", 2147483647)).toEqual({ ok: true });
    expect(store.writes).toHaveLength(1);
  });

  it("refuses negative or fractional cents", async () => {
    const { store, mine } = setup();
    expect((await setBudget(store, mine, "christmas", -1)).ok).toBe(false);
    expect((await setBudget(store, mine, "christmas", 1.5)).ok).toBe(false);
    expect(store.writes).toEqual([]);
  });
});

describe("linking a list", () => {
  it("links with a valid share link and shows the person keeps a list", async () => {
    const { store, mine } = setup();
    store.lists.set(TOKEN, "list-owner");
    expect(await linkList(store, mine, `https://giftsaf.test/share/${TOKEN}`)).toEqual({ ok: true });
    expect(store.rows.get(mine)!.linkedUserId).toBe("list-owner");
    expect((await listPeople(store, TODAY)).find((c) => c.id === mine)!.keepsList).toBe(true);
  });

  it("explains an unknown link", async () => {
    const { store, mine } = setup();
    expect(await linkList(store, mine, TOKEN)).toEqual({
      ok: false,
      error: "That link doesn't match a GiftsAF list.",
    });
  });

  it("explains the buyer's own list", async () => {
    const { store, mine } = setup();
    store.lists.set(TOKEN, ME);
    expect(await linkList(store, mine, TOKEN)).toEqual({ ok: false, error: "That's your own list." });
  });

  it("rejects text that is not a share link without calling the database", async () => {
    const { store, mine } = setup();
    const result = await linkList(store, mine, "hello");
    expect(result.ok).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it("unlinks", async () => {
    const { store, mine } = setup();
    store.rows.get(mine)!.linkedUserId = "list-owner";
    expect(await unlinkList(store, mine)).toEqual({ ok: true });
    expect(store.rows.get(mine)!.linkedUserId).toBeNull();
  });
});

describe("deletePerson and setPhoto", () => {
  it("hides a deleted person from the list", async () => {
    const { store, mine } = setup();
    expect(await deletePerson(store, mine)).toEqual({ ok: true });
    expect((await listPeople(store, TODAY)).map((c) => c.id)).not.toContain(mine);
  });

  it("sets and clears a photo inside the caller's own folder", async () => {
    const { store, mine } = setup();
    expect(await setPhoto(store, mine, `${ME}/${mine}/a.jpg`)).toEqual({ ok: true });
    expect(store.rows.get(mine)!.photoPath).toBe(`${ME}/${mine}/a.jpg`);
    expect(await setPhoto(store, mine, null)).toEqual({ ok: true });
    expect(store.rows.get(mine)!.photoPath).toBeNull();
  });

  it("refuses a photo path outside the caller's folder for that person", async () => {
    const { store, mine } = setup();
    for (const path of [`${OTHER}/${mine}/a.jpg`, `${ME}/other-person/a.jpg`, `${ME}/${mine}/../x.jpg`]) {
      expect((await setPhoto(store, mine, path)).ok).toBe(false);
    }
    expect(store.writes).toEqual([]);
  });
});

describe("another user's person, or nobody", () => {
  const calls: [string, (s: FakePeopleStore, id: string) => Promise<{ ok: boolean }>][] = [
    ["updatePerson", (s, id) => updatePerson(s, id, input({ birthday: { month: 1, day: 1 } }))],
    ["setOccasionEnabled", (s, id) => setOccasionEnabled(s, id, "christmas", false)],
    ["setBudget", (s, id) => setBudget(s, id, "christmas", 100)],
    ["linkList", (s, id) => { s.lists.set(TOKEN, "x"); return linkList(s, id, TOKEN); }],
    ["unlinkList", (s, id) => unlinkList(s, id)],
    ["setPhoto", (s, id) => setPhoto(s, id, `${ME}/${id}/a.jpg`)],
    ["deletePerson", (s, id) => deletePerson(s, id)],
  ];

  it.each(calls)("%s returns an error and changes nothing", async (_name, call) => {
    const { store, theirs } = setup();
    const before = JSON.stringify([store.occasionRows, store.budgetRows, [...store.rows], [...store.deleted]]);
    const result = await call(store, theirs);
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.writes).toEqual([]);
    expect(JSON.stringify([store.occasionRows, store.budgetRows, [...store.rows], [...store.deleted]])).toBe(before);
  });

  it.each(calls)("%s refuses an unknown person", async (_name, call) => {
    const { store } = setup();
    expect(await call(store, "nope")).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.writes).toEqual([]);
  });

  it("enabling a holiday the person lacks creates it, enabled, without a date", async () => {
    const { store, mine } = setup();
    expect(await setOccasionEnabled(store, mine, "mothers_day", true)).toEqual({ ok: true });
    expect(store.occasionRows.find((o) => o.personId === mine && o.kind === "mothers_day")).toMatchObject({
      enabled: true, month: null, day: null,
    });
    expect(store.writes).toEqual([`addOccasion ${mine} mothers_day`]);
  });

  it("turning off a holiday the person lacks is a no-op success", async () => {
    const { store, mine } = setup();
    expect(await setOccasionEnabled(store, mine, "fathers_day", false)).toEqual({ ok: true });
    expect(store.writes).toEqual([]);
  });

  it("enabling a missing birthday still errors, since it needs a date", async () => {
    const store = new FakePeopleStore();
    const id = store.seed(ME, { name: "Pat" }, [{ kind: "christmas" }]);
    expect((await setOccasionEnabled(store, id, "birthday", true)).ok).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it("enabling a missing holiday on another user's person errors with no writes", async () => {
    const { store, theirs } = setup();
    expect(await setOccasionEnabled(store, theirs, "mothers_day", true)).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.writes).toEqual([]);
  });

  it("getPerson lists all four holidays, missing ones switched off, ordered by date", async () => {
    const store = new FakePeopleStore();
    const id = store.seed(ME, { name: "Pat" }, [{ kind: "christmas" }]);
    const p = await getPerson(store, id, TODAY);
    expect(p!.occasions.map((o) => o.kind)).toEqual(["christmas", "valentines_day", "mothers_day", "fathers_day"].sort(
      (a, b) => p!.occasions.find((o) => o.kind === a)!.date.localeCompare(p!.occasions.find((o) => o.kind === b)!.date),
    ));
    const mothers = p!.occasions.find((o) => o.kind === "mothers_day");
    expect(mothers).toEqual({
      kind: "mothers_day", enabled: false, date: "2027-05-09", orderBy: null, budgetCents: null,
    });
    expect(p!.occasions.find((o) => o.kind === "christmas")!.enabled).toBe(true);
    expect(p!.occasions).toHaveLength(4);
  });
});

describe("when the database says no row changed", () => {
  it("updatePerson reports an error and does not touch occasions", async () => {
    const { store, mine } = setup();
    store.noRows.add("updatePerson");
    const result = await updatePerson(store, mine, input({ birthday: null }));
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.writes).toEqual([`updatePerson ${mine}`]);
  });

  it("setOccasionEnabled reports an error", async () => {
    const { store, mine } = setup();
    store.noRows.add("setEnabled");
    expect(await setOccasionEnabled(store, mine, "christmas", false)).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.occasionRows.find((o) => o.kind === "christmas" && o.personId === mine)!.enabled).toBe(true);
  });

  it("setPhoto reports an error", async () => {
    const { store, mine } = setup();
    store.noRows.add("setPhotoPath");
    expect(await setPhoto(store, mine, `${ME}/${mine}/a.jpg`)).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("a moved birthday that changes no row is an error", async () => {
    const { store, mine } = setup();
    store.noRows.add("moveOccasion");
    const result = await updatePerson(store, mine, input({ birthday: { month: 1, day: 9 }, anniversary: { month: 6, day: 5 } }));
    expect(result.ok).toBe(false);
  });
});
