import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const createAdminClient = vi.fn(() => {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is unset");
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
const { GET } = await import("../route");

describe("GET /api/rounds/tick", () => {
  it("AC-16: a call without the secret answers 401 and never builds the admin client", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(new Request("https://example.test/api/rounds/tick"));
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
