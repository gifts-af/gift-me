import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { birthdaySharingOn, getMyBirthday, removeMyBirthday, saveMyBirthday, type BirthdayDb } from "../account-birthday";

// The real table and its rules are in account_birthdays.test.sql; these check
// what each result turns into, and that events never hold the date.
let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const logged = () => log.mock.calls.map((c) => String(c[0])).join("\n");

function db(result: { data?: unknown; error?: { code: string } | null }) {
  const answer = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const upsert = vi.fn(() => answer);
  const chain = { select: () => chain, eq: () => Object.assign(answer, { maybeSingle: () => answer }), delete: () => chain, upsert };
  return { client: { from: () => chain } as unknown as BirthdayDb, upsert };
}

describe("your birthday", () => {
  it.each([
    [{ data: { month: 3, day: 14 } }, { kind: "saved", month: 3, day: 14 }],
    [{ data: null }, { kind: "none" }],
    [{ error: { code: "42501" } }, { kind: "unavailable" }],
  ])("reads %j", async (result, expected) => {
    expect(await getMyBirthday(db(result).client, "u1")).toEqual(expected);
  });

  it("saves one row per account, and logs the user id but not the date", async () => {
    const t = db({});
    expect(await saveMyBirthday(t.client, "u1", { month: 11, day: 23 })).toBe(true);
    expect(t.upsert).toHaveBeenCalledWith({ user_id: "u1", month: 11, day: 23 }, { onConflict: "user_id" });
    expect(logged()).toContain("account_birthday.saved");
    expect(logged()).toContain("u1");
    expect(logged()).not.toMatch(/"(month|day)"/);
  });

  it("reports a failed save and remove, with the code", async () => {
    expect(await saveMyBirthday(db({ error: { code: "23514" } }).client, "u1", { month: 1, day: 1 })).toBe(false);
    expect(await removeMyBirthday(db({ error: { code: "42501" } }).client, "u1")).toBe(false);
    expect(logged()).toContain("account_birthday.failed");
    expect(logged()).toContain("23514");
  });

  it("removes it", async () => {
    expect(await removeMyBirthday(db({}).client, "u1")).toBe(true);
    expect(logged()).toContain("account_birthday.removed");
  });
});

describe("birthdaySharingOn (AC-10)", () => {
  it.each([
    [1, 1, true],
    [0, 1, false],
    [2, 1, false],
    [1, 0, false],
  ])("birthday %i, list card %i: %s", async (birthday, card, on) => {
    expect(await birthdaySharingOn(async (key) => (key === "list_birthday_enabled" ? birthday : card))).toBe(on);
  });

  it("is off, not an error, when a setting can't be read", async () => {
    expect(
      await birthdaySharingOn(async () => {
        throw new Error("missing");
      }),
    ).toBe(false);
    expect(logged()).toContain("account_birthday.setting_failed");
  });
});
