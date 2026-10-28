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
});
