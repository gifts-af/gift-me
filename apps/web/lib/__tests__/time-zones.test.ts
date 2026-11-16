import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.restoreAllMocks());

  it("puts a saved zone missing from the server's list first", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago"]);
    expect(timeZoneOptions("UTC")).toEqual(["UTC", "America/Chicago"]);
  });

  it("also adds an extra zone, such as an alias the list doesn't show", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago"]);
    expect(timeZoneOptions("UTC", "Asia/Kolkata")).toEqual(["UTC", "Asia/Kolkata", "America/Chicago"]);
    expect(timeZoneOptions(null, "America/Chicago")).toEqual(["America/Chicago"]);
    expect(timeZoneOptions("Asia/Kolkata", "Asia/Kolkata")).toEqual(["Asia/Kolkata", "America/Chicago"]);
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
