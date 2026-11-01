// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const generateLink = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));

import { createExtensionToken } from "../actions";

beforeEach(() => {
  getUser.mockReset();
  generateLink.mockReset();
});

describe("createExtensionToken", () => {
  it("returns the hashed token for the signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } }, error: null });
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash123", action_link: "https://x/y", email_otp: "999" } },
      error: null,
    });
    expect(await createExtensionToken()).toEqual({ tokenHash: "hash123" });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "a@b.co" });
  });

  it("returns an error when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await createExtensionToken()).toEqual({ error: expect.any(String) });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("returns an error when the account has no email", async () => {
    getUser.mockResolvedValue({ data: { user: { email: null } }, error: null });
    expect(await createExtensionToken()).toEqual({
      error: "Your account has no email address, so the extension can't sign in.",
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("never returns action_link or the one-time code", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } }, error: null });
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "h", action_link: "https://x/y", email_otp: "999" } },
      error: null,
    });
    const result = await createExtensionToken();
    expect(Object.keys(result)).toEqual(["tokenHash"]);
    expect(JSON.stringify(result)).not.toContain("https://x/y");
    expect(JSON.stringify(result)).not.toContain("999");
  });

  it("returns an error when generateLink fails", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } }, error: null });
    generateLink.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await createExtensionToken();
    expect(result).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("boom");
  });
});
