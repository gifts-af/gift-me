import { describe, expect, it } from "vitest";
import { homePath, tabToRemember } from "../home-tab";

describe("homePath", () => {
  it.each<[string, string | undefined, boolean, string]>([
    ["My list on a new browser, even with access", undefined, true, "/lists"],
    ["My list on a new browser, without access", undefined, false, "/lists"],
    ["Give when you last used it and have access", "give", true, "/give"],
    ["My list when you last used Give but lost access", "give", false, "/lists"],
    ["My list when you last used it", "get", true, "/lists"],
    ["My list for a value we never set", "people", true, "/lists"],
  ])("%s", (_, cookie, access, to) => {
    expect(homePath(cookie, access)).toBe(to);
  });
});

describe("tabToRemember", () => {
  it.each<[string, string | undefined, string | null]>([
    ["/lists", undefined, "get"],
    ["/give", undefined, "give"],
    ["/give", "get", "give"],
    ["/lists", "give", "get"],
    // Already remembered: no cookie write on every page load.
    ["/lists", "get", null],
    ["/give", "give", null],
    // Only the two tab pages count, not pages under them or elsewhere.
    ["/people/123", undefined, null],
    ["/settings", "get", null],
    ["/", undefined, null],
  ])("%s with %s remembers %s", (path, current, tab) => {
    expect(tabToRemember(path, current)).toBe(tab);
  });
});
