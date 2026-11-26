import { describe, expect, it } from "vitest";
import { homePath, homeTabCookie } from "../home-tab";

describe("homePath", () => {
  it.each<[string, string | undefined, string]>([
    ["My list on a new browser", undefined, "/lists"],
    ["Give when it was the last tab used", "give", "/give"],
    ["My list when it was the last tab used", "get", "/lists"],
    ["My list for a value we never set", "people", "/lists"],
  ])("%s", (_, cookie, to) => {
    expect(homePath(cookie)).toBe(to);
  });
});

describe("homeTabCookie", () => {
  it("remembers the tab site-wide for as long as browsers allow, holding only its name", () => {
    expect(homeTabCookie("give", true)).toBe("home_tab=give; Path=/; Max-Age=34560000; SameSite=Lax; Secure");
  });

  it("drops Secure on plain http, so it still works locally", () => {
    expect(homeTabCookie("get", false)).toBe("home_tab=get; Path=/; Max-Age=34560000; SameSite=Lax");
  });
});
