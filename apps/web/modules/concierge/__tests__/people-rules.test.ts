// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAddressForm, parseBudget, parseImportRows, parsePersonForm, parseShareToken } from "../people/rules";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  const base = { name: "Mum", relationship: "mother", ...fields };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe("parsePersonForm", () => {
  it("accepts a minimal person", () => {
    expect(parsePersonForm(form({}), 2026)).toEqual({
      ok: true,
      value: { name: "Mum", relationship: "mother", birthday: null, birthYear: null, anniversary: null },
    });
  });

  it("trims the name", () => {
    const r = parsePersonForm(form({ name: "  Jo  " }), 2026);
    expect(r.ok && r.value.name).toBe("Jo");
  });

  it.each(["", "   ", "x".repeat(121)])("rejects name %j", (name) =>
    expect(parsePersonForm(form({ name }), 2026)).toEqual({ ok: false, error: "Enter a name." }),
  );

  it("accepts a 120 character name", () => {
    expect(parsePersonForm(form({ name: "x".repeat(120) }), 2026).ok).toBe(true);
  });

  it("rejects a missing name field", () => {
    const f = new FormData();
    f.set("relationship", "mother");
    expect(parsePersonForm(f, 2026)).toEqual({ ok: false, error: "Enter a name." });
  });

  it.each(["", "cousin", "Mother"])("rejects relationship %j", (relationship) =>
    expect(parsePersonForm(form({ relationship }), 2026)).toEqual({ ok: false, error: "Pick a relationship." }),
  );

  it("reads a birthday", () => {
    const r = parsePersonForm(form({ birthdayMonth: "3", birthdayDay: "14" }), 2026);
    expect(r.ok && r.value.birthday).toEqual({ month: 3, day: 14 });
  });

  it("accepts 29 Feb", () => {
    const r = parsePersonForm(form({ birthdayMonth: "2", birthdayDay: "29" }), 2026);
    expect(r.ok && r.value.birthday).toEqual({ month: 2, day: 29 });
  });

  it.each([
    ["2", "30"],
    ["4", "31"],
    ["13", "1"],
    ["0", "1"],
    ["1", "0"],
    ["3", ""],
    ["", "14"],
    ["x", "1"],
    ["1.5", "1"],
  ])("rejects birthday %j/%j", (birthdayMonth, birthdayDay) =>
    expect(parsePersonForm(form({ birthdayMonth, birthdayDay }), 2026)).toEqual({
      ok: false,
      error: "That date doesn't exist.",
    }),
  );

  it("reads a birth year within 1900..current", () => {
    for (const y of ["1900", "1985", "2026"]) {
      const r = parsePersonForm(form({ birthYear: y }), 2026);
      expect(r.ok && r.value.birthYear).toBe(Number(y));
    }
  });

  it.each(["1899", "2027", "abc", "19.5", "-1980"])("rejects birth year %j", (birthYear) => {
    const r = parsePersonForm(form({ birthYear }), 2026);
    expect(r.ok).toBe(false);
  });

  it("defaults the current year to now", () => {
    const next = String(new Date().getFullYear() + 1);
    expect(parsePersonForm(form({ birthYear: next })).ok).toBe(false);
  });

  it("keeps the anniversary for a wife or husband", () => {
    for (const relationship of ["wife", "husband"]) {
      const r = parsePersonForm(form({ relationship, anniversaryMonth: "6", anniversaryDay: "1" }), 2026);
      expect(r.ok && r.value.anniversary).toEqual({ month: 6, day: 1 });
    }
  });

  it("drops the anniversary for anyone else", () => {
    const r = parsePersonForm(form({ anniversaryMonth: "6", anniversaryDay: "1" }), 2026);
    expect(r.ok && r.value.anniversary).toBeNull();
  });

  it("keeps a partner's anniversary when editing (anyAnniversary)", () => {
    const fields = { relationship: "partner", anniversaryMonth: "6", anniversaryDay: "1" };
    const edit = parsePersonForm(form(fields), 2026, { anyAnniversary: true });
    expect(edit.ok && edit.value.anniversary).toEqual({ month: 6, day: 1 });
    const add = parsePersonForm(form(fields), 2026);
    expect(add.ok && add.value.anniversary).toBeNull();
  });

  it("rejects an impossible anniversary for a wife", () => {
    expect(
      parsePersonForm(form({ relationship: "wife", anniversaryMonth: "2", anniversaryDay: "30" }), 2026),
    ).toEqual({ ok: false, error: "That date doesn't exist." });
  });
});

describe("parseBudget", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["75", 7500],
    ["$75", 7500],
    [" $75 ", 7500],
    ["75.5", 7550],
    ["75.50", 7550],
    ["0.07", 7],
    ["0", 0],
    ["1.10", 110],
  ])("accepts %j", (input, cents) => expect(parseBudget(input)).toEqual({ ok: true, cents }));

  it.each(["-5", "75.555", "abc", "1e2", "$", "7 5", "75.", ".5x", "NaN"])("rejects %j", (input) =>
    expect(parseBudget(input)).toEqual({ ok: false, error: "Enter an amount like 75 or 75.50." }),
  );
});

describe("parseShareToken", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  it.each([
    `https://giftsaf.com/share/${id}`,
    `https://giftsaf.com/share/${id}/`,
    `https://giftsaf.com/share/${id}?utm=1`,
    `https://giftsaf.com/share/${id}#top`,
    `https://other.example/share/${id}`,
    `http://localhost:3000/share/${id}`,
    `  https://giftsaf.com/share/${id}  `,
    id,
    id.toUpperCase(),
  ])("extracts from %j", (input) => expect(parseShareToken(input)?.toLowerCase()).toBe(id));

  it.each([
    "",
    "garbage",
    "https://giftsaf.com/share/not-a-uuid",
    `https://giftsaf.com/lists/${id}`,
    `https://giftsaf.com/share/${id}/extra`,
    `https://giftsaf.com/x/share/${id}`,
    `${id}x`,
  ])("rejects %j", (input) => expect(parseShareToken(input)).toBeNull());
});

// ALL-24: rows sent by the import checklist. A bad row is refused on its own;
// the good ones still go through (AC-10).
describe("parseImportRows", () => {
  const good = {
    googleId: "people/c111",
    name: "Jane Allen",
    relationship: "mother",
    birthday: { month: 3, day: 14, year: 1960 },
    address: { firstName: "Jane", lastName: "Allen", line1: "1 Elm St", line2: null, city: "Springfield", state: "IL", zip: "62701", country: "US" },
    photoUrl: "https://lh3.googleusercontent.com/cm/ABC=s100",
  };
  const parse = (rows: unknown) => parseImportRows(JSON.stringify(rows), 2026);

  it("accepts a full row", () => {
    expect(parse([good])).toEqual({
      ok: true,
      refused: 0,
      rows: [
        {
          googleId: "people/c111",
          name: "Jane Allen",
          relationship: "mother",
          birthday: { month: 3, day: 14 },
          birthYear: 1960,
          address: good.address,
          photoUrl: good.photoUrl,
        },
      ],
    });
  });

  it("accepts a row with only a name, relationship and id", () => {
    const r = parse([{ googleId: "people/c2", name: "Sam", relationship: "friend" }]);
    expect(r).toMatchObject({ ok: true, refused: 0 });
    expect(r.ok && r.rows[0]).toMatchObject({ birthday: null, birthYear: null, address: null, photoUrl: null });
  });

  it.each([
    ["a made-up relationship", { relationship: "nemesis" }],
    ["an impossible date", { birthday: { month: 2, day: 30, year: null } }],
    ["a wrong-format contact id", { googleId: "contacts/123" }],
    ["no name", { name: "  " }],
    ["a photo on another host", { photoUrl: "https://evil.example/x.jpg" }],
    ["a photo over plain http", { photoUrl: "http://lh3.googleusercontent.com/x" }],
    ["an over-long address line", { address: { ...good.address, line1: "x".repeat(201) } }],
  ])("refuses a row with %s, and keeps the others", (_what, change) => {
    const r = parse([{ ...good, ...change }, { ...good, googleId: "people/c222" }]);
    expect(r).toMatchObject({ ok: true, refused: 1 });
    expect(r.ok && r.rows.map((x) => x.googleId)).toEqual(["people/c222"]);
  });

  it("drops a birth year it can't believe, but keeps the birthday", () => {
    const r = parse([{ ...good, birthday: { month: 3, day: 14, year: 1850 } }]);
    expect(r.ok && r.rows[0]).toMatchObject({ birthday: { month: 3, day: 14 }, birthYear: null });
  });

  it("sends the same contact only once", () => {
    const r = parse([good, good]);
    expect(r.ok && r.rows).toHaveLength(1);
  });

  it("refuses something that isn't a list of rows", () => {
    expect(parseImportRows("not json", 2026)).toEqual({ ok: false, error: "Nothing to import. Try again." });
    expect(parseImportRows("{}", 2026)).toEqual({ ok: false, error: "Nothing to import. Try again." });
    expect(parseImportRows("[]", 2026)).toEqual({ ok: false, error: "Nothing to import. Try again." });
  });
});

describe("parseAddressForm (ALL-81)", () => {
  const address = (over: Record<string, string> = {}) => {
    const f = new FormData();
    const base = { firstName: "Mary", lastName: "Smith", line1: "12 Oak Lane", line2: "", city: "Tampa", state: "FL", zip: "33602" };
    for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
    return f;
  };

  it("returns the checked address", () => {
    expect(parseAddressForm(address({ zip: "336021234" }))).toEqual({
      ok: true,
      value: { firstName: "Mary", lastName: "Smith", line1: "12 Oak Lane", line2: null, city: "Tampa", state: "FL", zip: "33602-1234" },
    });
  });

  it("returns a summary and a message per bad field", () => {
    expect(parseAddressForm(address({ city: "", state: "Florida" }))).toEqual({
      ok: false,
      error: "Check the address below.",
      fields: { city: "Add a city.", state: "Pick a state." },
    });
  });

  it("treats a missing field like an empty one", () => {
    const f = address();
    f.delete("zip");
    expect(parseAddressForm(f)).toMatchObject({ ok: false, fields: { zip: "Enter a 5-digit ZIP code." } });
  });
});
