import { describe, expect, it, vi } from "vitest";

// Next's guard that keeps this module out of browser code; not something of ours.
vi.mock("server-only", () => ({}));
const { seasonOn, shareSeason } = await import("@/lib/share-season");

const christmas = { name: "Christmas", start: "2026-11-01", end: "2026-12-26" };

describe("seasonOn (AC-2)", () => {
  it.each([
    ["2026-10-31", null],
    ["2026-11-01", "Christmas"],
    ["2026-11-27", "Christmas"],
    ["2026-12-25", "Christmas"],
    ["2026-12-26", null],
    ["2027-01-10", null],
  ])("on %s it is %s", (today, expected) => {
    expect(seasonOn(christmas, today)).toBe(expected);
  });

  it("is off with a blank name", () => {
    expect(seasonOn({ ...christmas, name: " " }, "2026-11-27")).toBeNull();
  });
});

type Row = { key: string; value: unknown };

function fakeDb(rows: Row[] | null, error: { code: string } | null = null) {
  const query = {
    select: () => query,
    in: async () => ({ data: rows, error }),
  };
  return { schema: () => ({ from: () => query }) } as unknown as Parameters<typeof shareSeason>[0];
}

describe("shareSeason", () => {
  const rows: Row[] = [
    { key: "share_season_name", value: "Christmas" },
    { key: "share_season_start", value: "2026-11-01" },
    { key: "share_season_end", value: "2026-12-26" },
  ];

  it("reads the season from app_settings (T23)", async () => {
    expect(await shareSeason(fakeDb(rows), "2026-11-27")).toBe("Christmas");
    expect(await shareSeason(fakeDb(rows), "2026-12-26")).toBeNull();
  });

  it("falls back to today's wording, and says so, when a setting is missing or unreadable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await shareSeason(fakeDb(rows.slice(1)), "2026-11-27")).toBeNull();
    expect(await shareSeason(fakeDb(null, { code: "42501" }), "2026-11-27")).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).toContain("share_season.unreadable");
    log.mockRestore();
  });
});
