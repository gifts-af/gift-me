// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPublicPath, signInRedirect } from "@/lib/supabase/proxy";

describe("isPublicPath", () => {
  it.each([
    "/lists",
    "/login",
    "/share/abc",
    "/auth/login",
    "/auth/callback",
    "/api/keepalive",
    // The browser fetches these to offer "Add to Home Screen", signed in or not.
    "/manifest.webmanifest",
    "/icon",
    "/icon.png",
    "/apple-icon",
    "/pwa-icon/192",
  ])("lets signed-out visitors reach %s", (path) => expect(isPublicPath(path)).toBe(true));

  it.each(["/", "/settings", "/api/other", "/lists/123"])(
    "sends signed-out visitors on %s to sign in",
    (path) => expect(isPublicPath(path)).toBe(false),
  );
});

describe("signInRedirect", () => {
  it("brings the visitor back to the page they asked for", () => {
    const url = signInRedirect(new URL("https://app.test/settings?tab=1"));
    expect(url.pathname).toBe("/auth/login");
    expect(url.searchParams.get("next")).toBe("/settings?tab=1");
  });

  it("leaves next off for Home, where sign-in lands anyway", () => {
    expect(signInRedirect(new URL("https://app.test/")).search).toBe("");
  });
});
