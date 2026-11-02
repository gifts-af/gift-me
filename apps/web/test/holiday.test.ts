// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isHolidaySeason } from "@/lib/holiday";

// Noon UTC keeps these dates the same day in US Eastern.
const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("holiday logo window (ALL-48)", () => {
  it("is on inside the window", () => {
    expect(isHolidaySeason("11-01..12-26", on("2026-12-10"))).toBe(true);
  });

  it("counts the first and last days as inside", () => {
    expect(isHolidaySeason("11-01..12-26", on("2026-11-01"))).toBe(true);
    expect(isHolidaySeason("11-01..12-26", on("2026-12-26"))).toBe(true);
  });

  it("is off outside the window", () => {
    expect(isHolidaySeason("11-01..12-26", on("2026-12-27"))).toBe(false);
    expect(isHolidaySeason("11-01..12-26", on("2026-07-04"))).toBe(false);
  });

  it("is off when no window is set", () => {
    expect(isHolidaySeason(undefined, on("2026-12-10"))).toBe(false);
    expect(isHolidaySeason("", on("2026-12-10"))).toBe(false);
  });

  it("handles a window that crosses New Year", () => {
    expect(isHolidaySeason("12-01..01-05", on("2026-12-31"))).toBe(true);
    expect(isHolidaySeason("12-01..01-05", on("2027-01-03"))).toBe(true);
    expect(isHolidaySeason("12-01..01-05", on("2027-03-01"))).toBe(false);
  });

  it("is off, without throwing, for a badly formed window", () => {
    for (const bad of ["christmas", "11-01", "13-01..12-26", "11-01..12-32", "11/01..12/26"]) {
      expect(isHolidaySeason(bad, on("2026-12-10"))).toBe(false);
    }
  });

  it("reads the date in US Eastern time", () => {
    // 03:00 UTC on Dec 27 is still the evening of Dec 26 in New York.
    expect(isHolidaySeason("11-01..12-26", new Date("2026-12-27T03:00:00Z"))).toBe(true);
  });
});
