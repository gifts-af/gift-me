import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getMySizes, parseSizesForm, removeMySizes, saveMySizes, sizesSharingOn, type SizesDb, type SizesRow } from "../account-sizes";

// The real table and its rules are in account_sizes.test.sql; these check what
// each result turns into, and that events never hold a value or a label.
let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const logged = () => log.mock.calls.map((c) => String(c[0])).join("\n");

function db(result: { data?: unknown; error?: { code: string } | null }) {
  const answer = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const upsert = vi.fn(() => answer);
  const del = vi.fn(() => chain);
  const chain = { select: () => chain, eq: () => Object.assign(answer, { maybeSingle: () => answer }), delete: del, upsert };
  return { client: { from: () => chain } as unknown as SizesDb, upsert, del };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("reading your sizes", () => {
  it("turns a row into items, empty boxes into null", async () => {
    const row = { top: "M", top_shared: true, shoe: "9", shoe_shared: false, color: null, color_shared: false };
    const got = await getMySizes(db({ data: row }).client, "u1");
    expect(got).toEqual({
      status: "loaded",
      items: { top: { value: "M", shared: true }, pants: null, dress: null, shoe: { value: "9", shared: false }, ring: null, hat: null, color: null },
    });
  });

  it("says loaded with nothing when there's no row", async () => {
    const got = await getMySizes(db({ data: null }).client, "u1");
    expect(got.status).toBe("loaded");
  });

  it("is unavailable, not empty, when the read fails", async () => {
    expect(await getMySizes(db({ error: { code: "42501" } }).client, "u1")).toEqual({ status: "unavailable" });
    expect(logged()).toContain("account_sizes.failed");
    expect(logged()).toContain("42501");
  });
});

describe("parseSizesForm (AC-3)", () => {
  it("trims, and reads each Share switch", () => {
    const r = parseSizesForm(form({ top: "  M  ", top_shared: "on", pants: "32" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.top).toBe("M");
    expect(r.row.top_shared).toBe(true);
    expect(r.row.pants).toBe("32");
    expect(r.row.pants_shared).toBe(false);
    expect(r.row.dress).toBeNull();
  });

  it("clears both the value and the share on an empty box", () => {
    const r = parseSizesForm(form({ hat: "   ", hat_shared: "on" }));
    expect(r.ok && r.row.hat).toBeNull();
    expect(r.ok && r.row.hat_shared).toBe(false);
  });

  it("accepts 30 code points, emoji included, and refuses 31", () => {
    expect(parseSizesForm(form({ color: "🙂".repeat(30) })).ok).toBe(true);
    const r = parseSizesForm(form({ color: "a".repeat(31) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.color).toMatch(/30/);
  });

  it.each(["two\nlines", "tab\there", "nul\u0000", "bell\u0007", "del\u007f"])("refuses control characters in %j", (value) => {
    const r = parseSizesForm(form({ ring: value }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.ring).toBe("Take out line breaks and tabs.");
  });
});

describe("saving and removing", () => {
  const row = { top: "M", top_shared: true } as unknown as SizesRow;
  it("is one upsert of the row, and logs the user id but no value", async () => {
    const t = db({});
    expect(await saveMySizes(t.client, "u1", row)).toBe(true);
    expect(t.upsert).toHaveBeenCalledOnce();
    expect(t.upsert).toHaveBeenCalledWith({ ...row, user_id: "u1" }, { onConflict: "user_id" });
    expect(logged()).toContain("account_sizes.saved");
    expect(logged()).toContain("u1");
    expect(logged()).not.toMatch(/"M"|Shirt/);
  });

  it("deletes the row, in one call, when every box is empty", async () => {
    const t = db({});
    const empty = parseSizesForm(form({}));
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(await saveMySizes(t.client, "u1", empty.row)).toBe(true);
    expect(t.upsert).not.toHaveBeenCalled();
    expect(t.del).toHaveBeenCalledOnce();
    expect(logged()).toContain("account_sizes.removed");
    expect(logged()).not.toContain("account_sizes.saved");
  });

  it("reports a failed save and remove, with the code", async () => {
    expect(await saveMySizes(db({ error: { code: "23514" } }).client, "u1", row)).toBe(false);
    expect(await removeMySizes(db({ error: { code: "42501" } }).client, "u1")).toBe(false);
    expect(logged()).toContain("23514");
    expect(logged()).toContain("42501");
  });

  it("removes it", async () => {
    expect(await removeMySizes(db({}).client, "u1")).toBe(true);
    expect(logged()).toContain("account_sizes.removed");
  });
});

describe("sizesSharingOn (AC-10)", () => {
  it.each([
    [1, 1, true],
    [0, 1, false],
    [2, 1, false],
    [1, 0, false],
  ])("sizes %i, list card %i: %s", async (sizes, card, on) => {
    expect(await sizesSharingOn(async (key) => (key === "list_sizes_enabled" ? sizes : card))).toBe(on);
  });

  it("is off, not an error, when a setting can't be read", async () => {
    expect(
      await sizesSharingOn(async () => {
        throw new Error("missing");
      }),
    ).toBe(false);
    expect(logged()).toContain("account_sizes.setting_failed");
  });
});
