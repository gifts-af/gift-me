import { describe, expect, it } from "vitest";
import { contactsFromPeopleApi, guessRelationship, isGooglePhotoUrl, sizedGooglePhotoUrl } from "./contacts";

// ALL-24: turning Google People API contacts into import rows.

const PHOTO = "https://lh3.googleusercontent.com/cm/ABC123=s100";

describe("contactsFromPeopleApi", () => {
  it("reads the name, birthday, address and photo of a contact", () => {
    const [mom] = contactsFromPeopleApi([
      {
        resourceName: "people/c111",
        names: [{ displayName: "Jane Allen", givenName: "Jane", familyName: "Allen", metadata: { primary: true } }],
        nicknames: [{ value: "Mom" }],
        birthdays: [{ date: { year: 1960, month: 3, day: 14 }, metadata: { primary: true } }],
        addresses: [
          {
            streetAddress: "1 Elm St",
            extendedAddress: "Apt 2",
            city: "Springfield",
            region: "IL",
            postalCode: "62701",
            countryCode: "us",
            metadata: { primary: true },
          },
        ],
        photos: [{ url: PHOTO, metadata: { primary: true } }],
      },
    ]);
    expect(mom).toEqual({
      googleId: "people/c111",
      name: "Jane Allen",
      firstName: "Jane",
      lastName: "Allen",
      nickname: "Mom",
      birthday: { month: 3, day: 14, year: 1960 },
      address: { line1: "1 Elm St", line2: "Apt 2", city: "Springfield", state: "IL", zip: "62701", country: "US" },
      photoUrl: PHOTO,
    });
  });

  it("leaves out contacts with no name, and sorts the rest A to Z", () => {
    const rows = contactsFromPeopleApi([
      { resourceName: "people/c1", names: [{ displayName: "zoe" }] },
      { resourceName: "people/c2", emailAddresses: [{ value: "x@example.com" }] },
      { resourceName: "people/c3", names: [{ displayName: "  " }] },
      { resourceName: "people/c4", names: [{ displayName: "Adam" }] },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Adam", "zoe"]);
  });

  // ALL-72: real names first; leading quote marks don't count.
  it("puts names that start with a letter first, and the rest after", () => {
    const names = ["#BAL - Check Balance", "'Donald Allen'", "'Bwaddington", "zoe", "Adam", "123 Pizza", "😀 Fun"];
    const rows = contactsFromPeopleApi(
      names.map((n, i) => ({ resourceName: `people/c${i}`, names: [{ displayName: n }] })),
    );
    const sorted = rows.map((r) => r.name);
    expect(sorted.slice(0, 4)).toEqual(["Adam", "'Bwaddington", "'Donald Allen'", "zoe"]);
    expect(new Set(sorted.slice(4))).toEqual(new Set(["#BAL - Check Balance", "123 Pizza", "😀 Fun"]));
  });

  it("keeps a birthday without a year, and drops one without a month and day", () => {
    const rows = contactsFromPeopleApi([
      { resourceName: "people/c1", names: [{ displayName: "A" }], birthdays: [{ date: { month: 7, day: 4 } }] },
      { resourceName: "people/c2", names: [{ displayName: "B" }], birthdays: [{ text: "sometime in June" }] },
      { resourceName: "people/c3", names: [{ displayName: "C" }], birthdays: [{ date: { year: 1990 } }] },
    ]);
    expect(rows.map((r) => r.birthday)).toEqual([{ month: 7, day: 4, year: null }, null, null]);
  });

  it("drops an impossible birthday", () => {
    const [row] = contactsFromPeopleApi([
      { resourceName: "people/c1", names: [{ displayName: "A" }], birthdays: [{ date: { month: 2, day: 30 } }] },
    ]);
    expect(row.birthday).toBeNull();
  });

  it("prefers the primary entry when there are several", () => {
    const [row] = contactsFromPeopleApi([
      {
        resourceName: "people/c1",
        names: [{ displayName: "Work name" }, { displayName: "Real name", metadata: { primary: true } }],
        addresses: [{ city: "Old town" }, { city: "Home town", metadata: { primary: true } }],
      },
    ]);
    expect(row.name).toBe("Real name");
    expect(row.address?.city).toBe("Home town");
  });

  it("splits a two-line street address, and leaves out an address with no street or city", () => {
    const rows = contactsFromPeopleApi([
      { resourceName: "people/c1", names: [{ displayName: "A" }], addresses: [{ streetAddress: "1 Elm St\nUnit 5", city: "X" }] },
      { resourceName: "people/c2", names: [{ displayName: "B" }], addresses: [{ region: "IL", countryCode: "US" }] },
    ]);
    expect(rows[0].address).toMatchObject({ line1: "1 Elm St", line2: "Unit 5", city: "X", country: null });
    expect(rows[1].address).toBeNull();
  });

  it("ignores Google's default letter avatar", () => {
    const [row] = contactsFromPeopleApi([
      { resourceName: "people/c1", names: [{ displayName: "A" }], photos: [{ url: PHOTO, default: true }] },
    ]);
    expect(row.photoUrl).toBeNull();
  });
});

describe("guessRelationship", () => {
  it.each([
    ["Mom", null, "mother"],
    ["Jane Allen", "Mum", "mother"],
    ["Mom cell", null, "mother"],
    ["Dad", null, "father"],
    ["Grandma Jo", null, "grandmother"],
    ["Nana", null, "grandmother"],
    ["Grandpa", null, "grandfather"],
    ["Hubby", null, "husband"],
    ["Wifey ❤️", null, "wife"],
  ])("%s (nickname %s) → %s", (name, nickname, expected) => {
    expect(guessRelationship(name, nickname)).toBe(expected);
  });

  it("doesn't guess from ordinary names", () => {
    expect(guessRelationship("Momo Tanaka", null)).toBeNull();
    expect(guessRelationship("Daddario Smith", null)).toBeNull();
    expect(guessRelationship("Sam", "Sammy")).toBeNull();
  });

  // Review on PR #39: words that are also first names only count as the whole name.
  it("doesn't take a first name like Poppy, Ma or Nan for a relationship", () => {
    expect(guessRelationship("Poppy Jones", null)).toBeNull();
    expect(guessRelationship("Ma Lin", null)).toBeNull();
    expect(guessRelationship("Nan Smith", null)).toBeNull();
    expect(guessRelationship("Gran Torino", null)).toBeNull();
    expect(guessRelationship("Poppy", null)).toBe("grandfather");
    expect(guessRelationship("Jo Allen", "Ma")).toBe("mother");
    expect(guessRelationship("Nan", null)).toBe("grandmother");
  });
});

describe("Google photo URLs", () => {
  it("accepts only https URLs on Google's photo host", () => {
    expect(isGooglePhotoUrl(PHOTO)).toBe(true);
    expect(isGooglePhotoUrl("https://lh5.googleusercontent.com/a/b")).toBe(true);
    expect(isGooglePhotoUrl("http://lh3.googleusercontent.com/a")).toBe(false);
    expect(isGooglePhotoUrl("https://evil.com/lh3.googleusercontent.com")).toBe(false);
    expect(isGooglePhotoUrl("https://googleusercontent.com.evil.com/a")).toBe(false);
    expect(isGooglePhotoUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isGooglePhotoUrl("not a url")).toBe(false);
  });

  it("asks Google for the photo at our size", () => {
    expect(sizedGooglePhotoUrl(PHOTO, 512)).toBe("https://lh3.googleusercontent.com/cm/ABC123=s512");
    expect(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/cm/ABC123", 512)).toBe(
      "https://lh3.googleusercontent.com/cm/ABC123=s512",
    );
    expect(sizedGooglePhotoUrl("https://lh3.googleusercontent.com/a/X=s96-c", 256)).toBe(
      "https://lh3.googleusercontent.com/a/X=s256",
    );
  });
});
