// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

const { GET } = await import("@/app/auth/callback/route");

function call(query: string) {
  return GET(new NextRequest(`https://app.test/auth/callback${query}`));
}

describe("GET /auth/callback", () => {
  beforeEach(() => exchangeCodeForSession.mockReset());

  it("signs in and returns to the requested page", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await call("?code=abc&next=%2Fsettings");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("https://app.test/settings");
  });

  it("never redirects off the site", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await call("?code=abc&next=%2F%2Fevil.com");
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("shows the error page when the code is refused", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "Code expired" } });
    const res = await call("?code=old");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("error")).toBe("failed");
  });

  it("shows Google's own error, e.g. when the user cancels", async () => {
    const res = await call("?error=access_denied&error_description=The+user+denied+access");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("error")).toBe("cancelled");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  // The error page only shows our own words, so a crafted link can't put
  // "Your account is locked, call 555…" on a GiftMe page.
  it("never passes the provider's text on to the error page", async () => {
    const res = await call("?error=x&error_description=Your+account+is+locked%2C+call+555");
    expect(res.headers.get("location")).toBe("https://app.test/auth/error?error=cancelled");
  });
});
