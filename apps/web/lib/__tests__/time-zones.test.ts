import { describe, expect, it } from "vitest";
import { isTimeZone, timeZoneOptions } from "../time-zones";

describe("isTimeZone", () => {
  it("accepts a real zone, including an alias the list doesn't show", () => {
    expect(isTimeZone("Asia/Calcutta")).toBe(true);
    expect(isTimeZone("America/Chicago")).toBe(true);
  });

  it("rejects a made-up zone and an empty one", () => {
    expect(isTimeZone("Mars/Base")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("timeZoneOptions", () => {
  it("puts a saved zone missing from the server's list first", () => {
    // Node's list has no "UTC", though browsers and the database accept it.
    expect(Intl.supportedValuesOf("timeZone")).not.toContain("UTC");
    const options = timeZoneOptions("UTC");
    expect(options[0]).toBe("UTC");
    expect(options.length).toBeGreaterThan(100);
  });

  it("has no duplicates when nothing is saved", () => {
    const options = timeZoneOptions(null);
    expect(new Set(options).size).toBe(options.length);
  });

  it("doesn't repeat a saved zone that's already in the list", () => {
    const options = timeZoneOptions("America/Chicago");
    expect(options.filter((zone) => zone === "America/Chicago")).toHaveLength(1);
    expect(new Set(options).size).toBe(options.length);
  });
});
