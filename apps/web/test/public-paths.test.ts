// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { homeRewrite, isPublicPath, signInRedirect, withCookies } from "@/lib/supabase/proxy";

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
    // The home page and tour (ALL-46).
    "/welcome",
    "/tour",
    "/request-access",
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

describe("homeRewrite", () => {
  it("shows signed-out visitors the home page at /", () => expect(homeRewrite("/", false)).toBe("/welcome"));
  it("leaves the app home alone for signed-in users", () => expect(homeRewrite("/", true)).toBeNull());
  it("only rewrites /", () => expect(homeRewrite("/settings", false)).toBeNull());
});

describe("withCookies", () => {
  it("copies refreshed session cookies onto the rewrite", () => {
    const from = NextResponse.next();
    from.cookies.set("sb-token", "fresh");
    const to = withCookies(from, NextResponse.rewrite(new URL("https://app.test/welcome")));
    expect(to.cookies.get("sb-token")?.value).toBe("fresh");
  });
});
