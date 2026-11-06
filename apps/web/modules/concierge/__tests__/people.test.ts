import { relationshipLabel } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import {
  addPerson,
  deletePerson,
  getPerson,
  importPeople,
  linkList,
  removeAddress,
  saveAddress,
  listPeople,
  setBudget,
  setOccasionEnabled,
  setPhoto,
  unlinkList,
  updatePerson,
} from "../people/service";
import type { ImportRow, PersonInput } from "../people/rules";
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

describe("a stored relationship we don't list", () => {
  it("lists and shows the person without throwing", async () => {
    const store = new FakePeopleStore();
    const id = store.seed(ME, { name: "Old", relationship: "parent" }, [{ kind: "christmas" }]);
    const cards = await listPeople(store, TODAY);
    expect(cards.map((c) => c.name)).toEqual(["Old"]);
    const detail = await getPerson(store, id, TODAY);
    expect(detail?.name).toBe("Old");
    expect(relationshipLabel(detail!.relationship)).toBe("Other");
  });
});

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

  it("keeps a wife's anniversary when she becomes a partner", async () => {
    const { store, mine } = setup();
    const before = store.occasionRows.find((o) => o.personId === mine && o.kind === "anniversary");
    await updatePerson(store, mine, input({ relationship: "partner", birthday: { month: 12, day: 1 }, anniversary: { month: 6, day: 5 } }));
    const after = store.occasionRows.find((o) => o.personId === mine && o.kind === "anniversary");
    expect(after).toMatchObject({ month: 6, day: 5 });
    expect(after).toEqual(before);
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

  it("linking does what saving an address does: this person's address holds are tried again (ALL-63 AC-20)", async () => {
    const { store, mine } = setup();
    store.lists.set(TOKEN, "list-owner");
    const placeHeld = vi.fn(async () => {});
    expect(await linkList(store, mine, TOKEN, placeHeld)).toEqual({ ok: true });
    expect(placeHeld).toHaveBeenCalledWith(ME, mine);
  });

  it("a failure placing them never fails the link, and a refused link places nothing (ALL-63 AC-20)", async () => {
    const { store, mine } = setup();
    store.lists.set(TOKEN, "list-owner");
    const broken = vi.fn(async () => {
      throw new Error("Zinc down");
    });
    expect(await linkList(store, mine, TOKEN, broken)).toEqual({ ok: true });

    const placeHeld = vi.fn(async () => {});
    await linkList(store, mine, "hello", placeHeld);
    expect(placeHeld).not.toHaveBeenCalled();
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

// ─── Google Contacts import (ALL-24) ────────────────────────────────────────

describe("importPeople", () => {
  const PHOTO = "https://lh3.googleusercontent.com/cm/ABC=s100";
  const row = (over: Partial<ImportRow> = {}): ImportRow => ({
    googleId: "people/c111",
    name: "Jane Allen",
    relationship: "mother",
    birthday: { month: 3, day: 14 },
    birthYear: 1960,
    address: {
      firstName: "Jane", lastName: "Allen", line1: "1 Elm St", line2: null,
      city: "Springfield", state: "IL", zip: "62701", country: "US",
    },
    photoUrl: null,
    ...over,
  });
  const image = (bytes = 2048, type = "image/jpeg") =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } });
  const deps = (fetch: typeof globalThis.fetch = vi.fn()) => ({ fetch, newId: () => "photo-1" });
  const sam = row({ googleId: "people/c222", name: "Sam", relationship: "friend", birthday: null, birthYear: null, address: null });

  it("adds each person with their relationship's occasions, birthday, Google id and address (AC-3)", async () => {
    const store = new FakePeopleStore();
    const result = await importPeople(store, [row(), sam], deps());
    expect(result).toEqual({ ok: true, added: 2, skipped: 0, failed: 0, photosMissed: 0 });
    const people = await store.people();
    const mom = people.find((p) => p.name === "Jane Allen")!;
    const friend = people.find((p) => p.name === "Sam")!;
    expect(mom).toMatchObject({ relationship: "mother", birthYear: 1960 });
    const kinds = (id: string) => store.occasionRows.filter((o) => o.personId === id).map((o) => o.kind).sort();
    expect(kinds(mom.id)).toEqual(["birthday", "christmas", "mothers_day"]);
    expect(store.occasionRows.find((o) => o.personId === mom.id && o.kind === "birthday")).toMatchObject({ month: 3, day: 14 });
    expect(kinds(friend.id)).toEqual(["christmas"]);
    expect(store.googleIds.get(mom.id)).toBe("people/c111");
    expect(store.addresses.get(mom.id)).toMatchObject({ line1: "1 Elm St", city: "Springfield" });
  });

  it("skips contacts already imported (AC-7)", async () => {
    const store = new FakePeopleStore();
    await importPeople(store, [row()], deps());
    const again = await importPeople(store, [row(), row({ googleId: "people/c333", name: "New" })], deps());
    expect(again).toMatchObject({ added: 1, skipped: 1, failed: 0 });
    expect((await store.people()).filter((p) => p.name === "Jane Allen")).toHaveLength(1);
  });

  it("counts a duplicate the database refuses as skipped, for two imports at once (AC-7)", async () => {
    const store = new FakePeopleStore();
    await importPeople(store, [row()], deps());
    store.importedContactIds = async () => [];
    expect(await importPeople(store, [row()], deps())).toMatchObject({ added: 0, skipped: 1, failed: 0 });
  });

  it("copies a Google photo into the buyer's own folder at our size (AC-6)", async () => {
    const store = new FakePeopleStore();
    const fetch = vi.fn(async () => image());
    const result = await importPeople(store, [row({ photoUrl: PHOTO })], deps(fetch));
    expect(result).toMatchObject({ added: 1, photosMissed: 0 });
    expect(fetch).toHaveBeenCalledWith(
      "https://lh3.googleusercontent.com/cm/ABC=s512",
      expect.objectContaining({ redirect: "error" }),
    );
    const [mom] = await store.people();
    expect(store.uploads).toEqual([{ path: `${ME}/${mom.id}/photo-1.jpg`, bytes: 2048, contentType: "image/jpeg" }]);
    expect(mom.photoPath).toBe(`${ME}/${mom.id}/photo-1.jpg`);
  });

  it.each([
    ["Google answers with an error", 10_485_760, async () => new Response("no", { status: 404 })],
    ["it isn't an image", 10_485_760, async () => image(100, "text/html")],
    ["it's bigger than the photo limit", 10, async () => image(20)],
    ["the network fails", 10_485_760, async () => { throw new Error("offline"); }],
  ])("still adds the person when %s, without a photo", async (_what, maxBytes, answer) => {
    const store = new FakePeopleStore();
    store.photoSize = { ...store.photoSize, maxBytes };
    const result = await importPeople(store, [row({ photoUrl: PHOTO })], deps(vi.fn(answer)));
    expect(result).toMatchObject({ added: 1, photosMissed: 1 });
    const [mom] = await store.people();
    expect(mom.photoPath).toBeNull();
    expect(store.uploads).toEqual([]);
  });

  it("skips a photo whose stated size is over the limit without reading it (review on PR #39)", async () => {
    const store = new FakePeopleStore();
    store.photoSize = { ...store.photoSize, maxBytes: 100 };
    const body = new ReadableStream({ pull: () => { throw new Error("the body was read"); } });
    const answer = new Response(body, { headers: { "content-type": "image/jpeg", "content-length": "5000" } });
    const result = await importPeople(store, [row({ photoUrl: PHOTO })], deps(vi.fn(async () => answer)));
    expect(result).toMatchObject({ added: 1, photosMissed: 1 });
    expect(store.uploads).toEqual([]);
  });

  it("stops reading a photo once it passes the limit, even without a stated size", async () => {
    const store = new FakePeopleStore();
    store.photoSize = { ...store.photoSize, maxBytes: 100 };
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: (c) => { chunks++; c.enqueue(new Uint8Array(60)); if (chunks > 50) c.close(); },
    });
    const answer = new Response(body, { headers: { "content-type": "image/jpeg" } });
    const result = await importPeople(store, [row({ photoUrl: PHOTO })], deps(vi.fn(async () => answer)));
    expect(result).toMatchObject({ photosMissed: 1 });
    expect(chunks).toBeLessThan(5);
  });

  it("gives each photo fetch the timeout from settings", async () => {
    const store = new FakePeopleStore();
    store.photoSize = { ...store.photoSize, timeoutMs: 1234 };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn(async () => image());
    await importPeople(store, [row({ photoUrl: PHOTO })], deps(fetch));
    expect(timeout).toHaveBeenCalledWith(1234);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    timeout.mockRestore();
  });

  it("copies photos a few at a time, not one after another (review on PR #39)", async () => {
    const store = new FakePeopleStore();
    store.photoSize = { ...store.photoSize, concurrency: 3 };
    let running = 0;
    let most = 0;
    const fetch = vi.fn(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return image();
    });
    const rows = Array.from({ length: 7 }, (_, i) => row({ googleId: `people/c${i}`, name: `P${i}`, photoUrl: PHOTO }));
    const result = await importPeople(store, rows, { fetch, newId: (() => { let n = 0; return () => `photo-${n++}`; })() });
    expect(result).toMatchObject({ added: 7, photosMissed: 0 });
    expect(most).toBe(3);
  });

  it("never fetches a photo from anywhere but Google's photo host (review focus 1)", async () => {
    const store = new FakePeopleStore();
    const fetch = vi.fn(async () => image());
    await importPeople(store, [row({ photoUrl: "https://169.254.169.254/latest/meta-data" })], deps(fetch));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts a person the database won't save as failed, and carries on", async () => {
    const store = new FakePeopleStore();
    const create = store.createPerson.bind(store);
    store.createPerson = async (p) => {
      if (p.name === "Broken") throw new Error("boom");
      return create(p);
    };
    const result = await importPeople(store, [row({ googleId: "people/c9", name: "Broken" }), row()], deps());
    expect(result).toMatchObject({ added: 1, skipped: 0, failed: 1 });
  });

  it("needs a signed-in buyer", async () => {
    const store = new FakePeopleStore();
    store.caller = null;
    expect(await importPeople(store, [row()], deps())).toEqual({ ok: false, error: "Your session ended. Sign in again." });
    expect(store.writes).toEqual([]);
  });
});

describe("a person's shipping address (ALL-81)", () => {
  const NOW = new Date("2026-11-03T15:00:00Z");
  const address = {
    firstName: "Mary", lastName: "Smith", line1: "12 Oak Lane", line2: "Apt 3", city: "Tampa", state: "FL", zip: "33602",
  };
  const ADDRESS_TEXT = ["Mary", "Smith", "12 Oak Lane", "Apt 3", "Tampa", "33602"];

  it("saves the address as a US address, checked now (AC-2, AC-4)", async () => {
    const { store, mine } = setup();
    expect(await saveAddress(store, mine, address, NOW)).toEqual({ ok: true });
    expect(store.addressRows.get(mine)).toEqual({ ...address, country: "US", checkedAt: "2026-11-03T15:00:00.000Z" });
  });

  it("re-places this person's address holds after a save, and a failure there never fails the save (ALL-32 AC-21)", async () => {
    const { store, mine, theirs } = setup();
    const placeHeld = vi.fn(async () => {});
    expect(await saveAddress(store, mine, address, NOW, placeHeld)).toEqual({ ok: true });
    expect(placeHeld).toHaveBeenCalledWith(ME, mine);

    const broken = vi.fn(async () => {
      throw new Error("Zinc down");
    });
    expect(await saveAddress(store, mine, address, NOW, broken)).toEqual({ ok: true });

    placeHeld.mockClear();
    await saveAddress(store, theirs, address, NOW, placeHeld);
    expect(placeHeld).not.toHaveBeenCalled();
  });

  it("removes the address in one write (AC-6)", async () => {
    const { store, mine } = setup();
    await saveAddress(store, mine, address, NOW);
    expect(await removeAddress(store, mine)).toEqual({ ok: true });
    expect(store.addressRows.get(mine)).toBeNull();
    expect(store.writes.filter((w) => w.startsWith("saveAddress"))).toHaveLength(2);
  });

  it.each([
    ["someone else's person", "theirs"],
    ["a made-up id", "not-a-uuid"],
    ["a deleted person", "deleted"],
  ])("refuses %s and writes nothing (AC-13)", async (_label, which) => {
    const { store, mine, theirs } = setup();
    const id = which === "theirs" ? theirs : which === "deleted" ? mine : which;
    if (which === "deleted") store.deleted.add(mine);
    expect(await saveAddress(store, id, address, NOW)).toEqual({ ok: false, error: NOT_FOUND });
    expect(await removeAddress(store, id)).toEqual({ ok: false, error: NOT_FOUND });
    expect(store.writes.filter((w) => w.startsWith("saveAddress"))).toEqual([]);
  });

  it("won't change or remove an address the list owner shares (AC-12)", async () => {
    const { store, mine } = setup();
    store.shared.set(mine, { city: "Tampa", state: "FL" });
    expect(await saveAddress(store, mine, address, NOW)).toEqual({ ok: false, error: "Their address is kept by them." });
    expect(await removeAddress(store, mine)).toEqual({ ok: false, error: "Their address is kept by them." });
    expect(store.writes.filter((w) => w.startsWith("saveAddress"))).toEqual([]);
  });

  it("keeps the address out of the logs when a save fails (AC-14)", async () => {
    const { store, mine } = setup();
    store.failSaveAddress = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await saveAddress(store, mine, address, NOW)).toEqual({ ok: false, error: "That couldn't be saved. Try again." });
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls].map((c) => c.map(String)));
    error.mockRestore();
    log.mockRestore();
    expect(logged).toContain("person_address_failed");
    for (const t of ADDRESS_TEXT) expect(logged).not.toContain(t);
  });

  describe("on the person's page", () => {
    it("is none when nothing is stored", async () => {
      const { store, mine } = setup();
      expect((await getPerson(store, mine, TODAY))?.address).toEqual({ kind: "none" });
    });

    it("is none after a remove", async () => {
      const { store, mine } = setup();
      await saveAddress(store, mine, address, NOW);
      await removeAddress(store, mine);
      expect((await getPerson(store, mine, TODAY))?.address).toEqual({ kind: "none" });
    });

    it("is the buyer's own, complete, after a save", async () => {
      const { store, mine } = setup();
      await saveAddress(store, mine, address, NOW);
      expect((await getPerson(store, mine, TODAY))?.address).toEqual({ kind: "own", address, problems: {} });
    });

    it("marks what an imported address is missing (AC-10)", async () => {
      const { store, mine } = setup();
      store.addressRows.set(mine, {
        firstName: null, lastName: null, line1: "12 Oak Lane", line2: null, city: "Tampa", state: "Florida", zip: "33602",
        country: "US", checkedAt: null,
      });
      const detail = await getPerson(store, mine, TODAY);
      expect(detail?.address).toEqual({
        kind: "own",
        address: { firstName: null, lastName: null, line1: "12 Oak Lane", line2: null, city: "Tampa", state: "Florida", zip: "33602" },
        problems: { firstName: "Add their first name.", lastName: "Add their last name.", state: "Pick a state." },
      });
    });

    it("shows only the city and state of a shared address, even when the buyer saved one (AC-12)", async () => {
      const { store, mine } = setup();
      await saveAddress(store, mine, address, NOW);
      store.shared.set(mine, { city: "Orlando", state: "FL" });
      const detail = await getPerson(store, mine, TODAY);
      expect(detail?.address).toEqual({ kind: "shared", city: "Orlando", state: "FL" });
      expect(JSON.stringify(detail)).not.toContain("12 Oak Lane");
    });
  });
});
