import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect ${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));
const { GET } = await import("@/app/auth/confirm/route");

const SITE = "https://giftsaf.com";
const SHARE = "/share/11111111-2222-4333-8444-555555555555";

// The email template writes {{ .RedirectTo }} into the link, as it is or escaped.
const links = (type: string, next: string) =>
  [next, encodeURIComponent(next)].map((value) => `${SITE}/auth/confirm?token_hash=t&type=${type}&next=${value}`);

describe("GET /auth/confirm, from production's email templates", () => {
  beforeEach(() => {
    redirect.mockClear();
    verifyOtp.mockReset().mockResolvedValue({ error: null });
  });

  describe.each(["email", "recovery"])("type %s", (type) => {
    it.each([
      [`${SITE}/`, "/"],
      [`${SITE}${SHARE}`, SHARE],
      [`${SITE}/auth/update-password`, "/auth/update-password"],
      ["https://evil.example/lists", "/"],
      [`${SITE}.evil.example/lists`, "/"],
      [`${SITE}@evil.example/lists`, "/"],
    ])("next %s goes to %s", async (next, to) => {
      for (const link of links(type, next)) {
        await expect(GET(new NextRequest(link))).rejects.toThrow(`redirect ${to}`);
        expect(redirect).toHaveBeenLastCalledWith(to);
        expect(verifyOtp).toHaveBeenLastCalledWith({ type, token_hash: "t" });
      }
    });
  });

  it("a refused link goes to the error page, not to next", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    await expect(GET(new NextRequest(links("email", `${SITE}${SHARE}`)[0]))).rejects.toThrow("redirect /auth/error?error=failed");
    log.mockRestore();
  });
});
