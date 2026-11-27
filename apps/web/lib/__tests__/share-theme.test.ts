// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { SHARE_LIGHT_SCRIPT } from "../share-theme";

const run = () => new Function(SHARE_LIGHT_SCRIPT)();

function clearCookies() {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("a shared list opens light for signed-out visitors", () => {
  afterEach(() => {
    localStorage.clear();
    clearCookies();
    window.history.replaceState(null, "", "/");
  });

  it("saves light on a shared list when no theme was chosen", () => {
    window.history.replaceState(null, "", "/share/abc");
    run();
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("keeps a theme the visitor already picked", () => {
    window.history.replaceState(null, "", "/share/abc");
    localStorage.setItem("theme", "dark");
    run();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("leaves signed-in visitors to their device", () => {
    window.history.replaceState(null, "", "/share/abc");
    document.cookie = "sb-pegtruc-auth-token.0=x; path=/";
    run();
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("does nothing on other pages", () => {
    window.history.replaceState(null, "", "/lists");
    run();
    expect(localStorage.getItem("theme")).toBeNull();
  });
});
