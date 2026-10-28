// @vitest-environment node
import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it.each(["/settings", "/share/abc?as=guest", "/"])("keeps the same-site path %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "settings", "", null, undefined])(
    "falls back to / for %s",
    (value) => expect(safeNext(value)).toBe("/"),
  );

  // Browsers drop tabs and newlines from URLs, so "/\t/evil.com" loads
  // as "//evil.com". The check has to judge the URL the browser will load.
  it.each(["/\t/evil.com", "/\n/evil.com", "/\r\\evil.com", "/\t\\evil.com", " //evil.com"])(
    "falls back to / for %j",
    (value) => expect(safeNext(value)).toBe("/"),
  );

  it("keeps a full URL on the same site as its path", () => {
    expect(safeNext("https://app.test/lists?x=1#top", "https://app.test")).toBe("/lists?x=1#top");
  });

  it("refuses a full URL on another site even with an origin", () => {
    expect(safeNext("https://evil.com/lists", "https://app.test")).toBe("/");
  });
});

describe("GET /auth/confirm", () => {
  it("never sends a confirmed user off the site", async () => {
    const { vi } = await import("vitest");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { verifyOtp: async () => ({ error: null }) } }),
    }));
    const redirect = vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    });
    vi.doMock("next/navigation", () => ({ redirect }));
    const { GET } = await import("@/app/auth/confirm/route");
    const { NextRequest } = await import("next/server");
    await expect(
      GET(new NextRequest("https://app.test/auth/confirm?token_hash=t&type=email&next=%2F%2Fevil.com")),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("follows a full same-site link, as email templates using RedirectTo send", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { verifyOtp: async () => ({ error: null }) } }),
    }));
    const redirect = vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    });
    vi.doMock("next/navigation", () => ({ redirect }));
    const { GET } = await import("@/app/auth/confirm/route");
    const { NextRequest } = await import("next/server");
    await expect(
      GET(
        new NextRequest(
          "https://app.test/auth/confirm?token_hash=t&type=email&next=" + encodeURIComponent("https://app.test/lists"),
        ),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/lists");
  });
});
