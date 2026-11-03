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
    "/api/rounds/tick",
    // The Chrome extension posts captures here with a bearer token (ALL-22).
    "/api/captures",
    // ...and retries a capture's read the same way (ALL-25).
    "/api/captures/0b6f7c3e-1a2b-4c5d-8e9f-001122334455/extract",
    // The browser fetches these to offer "Add to Home Screen", signed in or not.
    "/manifest.webmanifest",
    "/icon",
    "/icon.png",
    "/apple-icon",
    "/pwa-icon/192",
    // The home page and tour (ALL-46).
    "/welcome",
    "/tour",
    "/tour/list",
    // The logo image at the top of every email (ALL-71).
    "/email-logo.png",
    "/request-access",
    // Link-preview crawlers (LinkedIn, Slack…) are never signed in (ALL-55).
    "/opengraph-image",
    // One-time email action links show their own sign-in page (ALL-23).
    "/a/abc",
  ])("lets signed-out visitors reach %s", (path) => expect(isPublicPath(path)).toBe(true));

  it.each(["/", "/settings", "/api/other", "/lists/123", "/api/captures/x/other", "/api/captures/a/b/extract"])(
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
