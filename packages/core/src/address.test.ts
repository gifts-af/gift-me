import { describe, expect, it } from "vitest";
import { ADDRESS_FIELD_MAX, checkAddress, isShippableAddress, splitRecipientName, US_STATES, checkOwnAddress } from "./address";

const good = {
  firstName: " Mary ",
  lastName: "Smith",
  line1: "12 Oak Lane",
  line2: "",
  city: "Tampa",
  state: "FL",
  zip: "33602",
};

describe("checkAddress", () => {
  it("accepts a complete address, trimmed, with an empty line 2 saved as null", () => {
    expect(checkAddress(good)).toEqual({
      ok: true,
      value: { firstName: "Mary", lastName: "Smith", line1: "12 Oak Lane", line2: null, city: "Tampa", state: "FL", zip: "33602" },
    });
  });

  it("keeps line 2 when given", () => {
    const r = checkAddress({ ...good, line2: " Apt 3 " });
    expect(r.ok && r.value.line2).toBe("Apt 3");
  });

  it("trims a ZIP with spaces", () => {
    const r = checkAddress({ ...good, zip: " 33602 " });
    expect(r.ok && r.value.zip).toBe("33602");
  });

  it("accepts ZIP+4, and saves 9 bare digits with the hyphen", () => {
    const plus4 = checkAddress({ ...good, zip: "33602-1234" });
    expect(plus4.ok && plus4.value.zip).toBe("33602-1234");
    const bare = checkAddress({ ...good, zip: "336021234" });
    expect(bare.ok && bare.value.zip).toBe("33602-1234");
  });

  it("accepts DC", () => {
    expect(checkAddress({ ...good, state: "DC" }).ok).toBe(true);
  });

  it("names each missing required field in plain words", () => {
    expect(checkAddress({})).toEqual({
      ok: false,
      errors: {
        firstName: "Add their first name.",
        lastName: "Add their last name.",
        line1: "Add a street address.",
        city: "Add a city.",
        state: "Pick a state.",
        zip: "Enter a 5-digit ZIP code.",
      },
    });
  });

  it("treats spaces only as missing", () => {
    const r = checkAddress({ ...good, city: "   " });
    expect(r).toEqual({ ok: false, errors: { city: "Add a city." } });
  });

  it.each(["fl", "Florida", "PR", "XX"])("refuses state %j without changing its case", (state) => {
    expect(checkAddress({ ...good, state })).toEqual({ ok: false, errors: { state: "Pick a state." } });
  });

  it.each(["3360", "ABCDE", "33602-12", "33602 1234", "3360212345"])("refuses ZIP %j", (zip) => {
    expect(checkAddress({ ...good, zip })).toEqual({ ok: false, errors: { zip: "Enter a 5-digit ZIP code." } });
  });

  it("refuses any field over 200 characters, line 2 included", () => {
    const long = "a".repeat(ADDRESS_FIELD_MAX + 1);
    expect(checkAddress({ ...good, line1: long, line2: long })).toEqual({
      ok: false,
      errors: { line1: "Keep this under 200 characters.", line2: "Keep this under 200 characters." },
    });
    expect(checkAddress({ ...good, city: "a".repeat(ADDRESS_FIELD_MAX) }).ok).toBe(true);
  });

  it("reports every bad field at once", () => {
    const r = checkAddress({ ...good, city: "", zip: "123" });
    expect(r).toEqual({ ok: false, errors: { city: "Add a city.", zip: "Enter a 5-digit ZIP code." } });
  });
});

describe("US_STATES", () => {
  it("has the 50 states and DC, with unique two-letter codes", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
    for (const s of US_STATES) expect(s.code).toMatch(/^[A-Z]{2}$/);
    expect(US_STATES.find((s) => s.code === "DC")?.name).toBe("District of Columbia");
  });

  it("is in A–Z order by name", () => {
    const names = US_STATES.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("isShippableAddress", () => {
  it("is true for a complete US address", () => {
    expect(isShippableAddress({ ...good, country: "US" })).toBe(true);
  });

  it.each([["CA"], [null], [undefined]])("is false when the country is %j", (country) => {
    expect(isShippableAddress({ ...good, country })).toBe(false);
  });

  it("is false without the recipient's names, as some imports are", () => {
    expect(isShippableAddress({ ...good, firstName: null, lastName: null, country: "US" })).toBe(false);
  });
});

describe("splitRecipientName", () => {
  it.each([
    ["Mary Jane Smith", { firstName: "Mary Jane", lastName: "Smith" }],
    ["Cher", { firstName: "Cher", lastName: "" }],
    ["  Ann  Lee ", { firstName: "Ann", lastName: "Lee" }],
    ["", { firstName: "", lastName: "" }],
  ])("splits %j on the last space", (name, want) => {
    expect(splitRecipientName(name)).toEqual(want);
  });
});

describe("checkOwnAddress", () => {
  const GOOD = { firstName: "Sam", lastName: "Rivera", line1: "44 Elm St", city: "Columbus", state: "OH", zip: "43215" };

  it("speaks to the owner when their names are missing", () => {
    const result = checkOwnAddress({});
    expect(result).toMatchObject({
      ok: false,
      errors: { firstName: "Add your first name.", lastName: "Add your last name." },
    });
  });

  it("keeps every other message as it is", () => {
    const own = checkOwnAddress({ ...GOOD, city: "", zip: "123" });
    expect(own).toEqual(checkAddress({ ...GOOD, city: "", zip: "123" }));
  });

  it("returns the same value as checkAddress for a good address", () => {
    expect(checkOwnAddress(GOOD)).toEqual(checkAddress(GOOD));
  });
});
