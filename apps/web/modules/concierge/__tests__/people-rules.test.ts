// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseBudget, parsePersonForm, parseShareToken } from "../people/rules";

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
