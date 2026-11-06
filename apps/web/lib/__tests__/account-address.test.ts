// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMyAddress,
  getSharing,
  parseMyAddressForm,
  removeMyAddress,
  saveMyAddress,
  setSharing,
  type AccountAddressDb,
} from "../account-address";

const ADDRESS = { firstName: "Sam", lastName: "Rivera", line1: "44 Elm St", line2: null, city: "Columbus", state: "OH", zip: "43215" };
const SECRET = "Failing row contains (44 Elm St, Columbus, Sam Rivera)";
const FAILED = { data: null, error: { code: "23514", message: SECRET, details: SECRET, hint: SECRET } };

/** A client whose every query fails, because a real failure can't be forced (AC-22, AC-23). */
function failingDb(): AccountAddressDb {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve(FAILED),
    upsert: () => Promise.resolve(FAILED),
    update: () => query,
    delete: () => query,
    then: (resolve: (v: typeof FAILED) => unknown) => Promise.resolve(FAILED).then(resolve),
  };
  return { from: () => query } as unknown as AccountAddressDb;
}

describe("failed reads and writes", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  beforeEach(() => {
    log.mockClear();
    error.mockClear();
  });
  afterEach(() => {
    const written = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(written).not.toContain("Elm");
    expect(written).not.toContain("Rivera");
    expect(written).not.toContain("Columbus");
    expect(written).toContain("account_address_failed");
    expect(written).toContain("23514");
    expect(written).toContain("user-1");
  });

  it("reading my address is unavailable, not empty", async () => {
    await expect(getMyAddress(failingDb(), "user-1")).resolves.toEqual({ kind: "unavailable" });
  });

  it("reading my sharing state is unavailable, not empty", async () => {
    await expect(getSharing(failingDb(), "user-1")).resolves.toEqual({ kind: "unavailable" });
  });

  it("a failed save returns false", async () => {
    await expect(saveMyAddress(failingDb(), "user-1", ADDRESS, new Date("2026-11-06T00:00:00Z"))).resolves.toBe(false);
  });

  it("a failed remove returns false", async () => {
    await expect(removeMyAddress(failingDb(), "user-1")).resolves.toBe(false);
  });

  it("a failed sharing change reports failed", async () => {
    await expect(setSharing(failingDb(), "user-1", true)).resolves.toBe("failed");
  });
});

describe("parseMyAddressForm", () => {
  function form(values: Record<string, string | File>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }

  it("returns a good address, trimmed", () => {
    const parsed = parseMyAddressForm(
      form({ firstName: " Sam ", lastName: "Rivera", line1: "44 Elm St", line2: "", city: "Columbus", state: "OH", zip: "43215" }),
    );
    expect(parsed).toEqual({ ok: true, value: ADDRESS });
  });

  it("speaks to the owner about bad fields", () => {
    const parsed = parseMyAddressForm(form({ line1: "44 Elm St", city: "Columbus", state: "Ohio", zip: "1" }));
    expect(parsed).toEqual({
      ok: false,
      errors: {
        firstName: "Add your first name.",
        lastName: "Add your last name.",
        state: "Pick a state.",
        zip: "Enter a 5-digit ZIP code.",
      },
    });
  });

  it("counts a file in a field as empty", () => {
    const parsed = parseMyAddressForm(
      form({ firstName: new File(["x"], "x.txt"), lastName: "Rivera", line1: "44 Elm St", city: "Columbus", state: "OH", zip: "43215" }),
    );
    expect(parsed).toMatchObject({ ok: false, errors: { firstName: "Add your first name." } });
  });
});
