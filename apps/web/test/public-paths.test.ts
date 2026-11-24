import { readdirSync } from "node:fs";
import path from "node:path";
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
    "/api/health",
    "/api/rounds/tick",
    // Only Vercel's queue calls the job route (ALL-125).
    "/api/rounds/job",
    // Resend posts inbound mail here, signed with Svix (ALL-31).
    "/api/inbound/resend",
    // Zinc posts each buyer's order and wallet events here, signed (ALL-32, ALL-164).
    "/api/zinc/webhook/0b6f7c3e-1a2b-4c5d-8e9f-001122334455",
    // The Chrome extension posts captures here with a bearer token (ALL-22).
    "/api/captures",
    // ...and retries a capture's read the same way (ALL-25).
    "/api/captures/0b6f7c3e-1a2b-4c5d-8e9f-001122334455/extract",
    // A closing My list tab posts here with keepalive; signed out gets a 401
    // from the route, never a redirect to follow (ALL-127).
    "/api/lists/save-on-close",
    // The extension adds a gift to My list with a bearer token (ALL-78).
    "/api/lists/items",
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
    // The privacy policy the Chrome Web Store listing links to (ALL-65).
    "/privacy",
    // The logo image at the top of every email (ALL-71).
    "/email-logo.png",
    "/request-access",
    // Link-preview crawlers (LinkedIn, Slack…) are never signed in (ALL-55).
    "/opengraph-image",
    // One-time email action links show their own sign-in page (ALL-23).
    "/a/abc",
  ])("lets signed-out visitors reach %s", (path) => expect(isPublicPath(path)).toBe(true));

  it.each(["/", "/settings", "/api/other", "/api/keepalive", "/lists/123", "/api/captures/x/other", "/api/captures/a/b/extract", "/api/lists/items/x", "/api/zinc/webhook", "/api/zinc/webhook/", "/api/zinc/webhook/a/b", "/api/zinc/other"])(
    "sends signed-out visitors on %s to sign in",
    (path) => expect(isPublicPath(path)).toBe(false),
  );
});

// Every API route checks its own caller (a signature, a secret, a token or the session), because
// a redirect to the sign-in page means nothing to a program. A new one fails here until it's public.
describe("every API route", () => {
  const api = path.resolve(__dirname, "../app/api");
  const routes = readdirSync(api, { recursive: true, encoding: "utf8" })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => /(^|\/)route\.tsx?$/.test(f))
    .map((f) => `/api/${f.replace(/\/?route\.tsx?$/, "")}`.replace(/\[[^\]]+\]/g, "0b6f7c3e-1a2b-4c5d-8e9f-001122334455"));

  it("finds the routes", () => expect(routes).toContain("/api/health"));
  it.each(routes)("%s answers for itself, with no redirect to sign in", (route) => expect(isPublicPath(route)).toBe(true));
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
