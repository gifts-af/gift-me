// The return from Stripe's card page: it needs the signed-in buyer, and sends them where
// finishCardSession says. What finishCardSession checks, against the real database, is in
// modules/concierge/__tests__/card-db.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const finishCardSession = vi.fn();
const stripeWiring = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/wiring", () => ({ stripeWiring: (...a: unknown[]) => stripeWiring(...a) }));
vi.mock("@/modules/concierge", () => ({ finishCardSession: (...a: unknown[]) => finishCardSession(...a) }));

const { GET } = await import("../route");

const get = (q = "?session_id=cs_test_1") => GET(new Request(`https://giftsaf.test/rounds/card/return${q}`) as never);
const where = (res: Response) => {
  const u = new URL(res.headers.get("location")!);
  return u.pathname + u.search;
};

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  finishCardSession.mockReset();
  stripeWiring.mockReset().mockResolvedValue({ key: "sk_test_x", mode: "test", timeoutMs: 1, fetch });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GET /rounds/card/return", () => {
  it("sends a signed-out visitor to sign in, then back here", async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(where(await get())).toBe("/auth/login?next=%2Frounds%2Fcard%2Freturn%3Fsession_id%3Dcs_test_1");
    expect(finishCardSession).not.toHaveBeenCalled();
  });

  it("finishes the signed-in buyer's visit and goes back to the gift", async () => {
    finishCardSession.mockResolvedValue({ status: "saved", backTo: "/rounds/r1/buy?ideas=a,b" });
    expect(where(await get())).toBe("/rounds/r1/buy?ideas=a,b");
    expect(finishCardSession).toHaveBeenCalledWith(expect.objectContaining({ siteUrl: expect.any(String) }), {
      userId: "user-1",
      sessionId: "cs_test_1",
    });
  });

  it("goes back to the gift saying it was cancelled", async () => {
    finishCardSession.mockResolvedValue({ status: "cancelled", backTo: "/rounds/r1/buy?ideas=a" });
    expect(where(await get())).toBe("/rounds/r1/buy?ideas=a&card=cancelled");
    finishCardSession.mockResolvedValue({ status: "cancelled", backTo: "/rounds/r1" });
    expect(where(await get())).toBe("/rounds/r1?card=cancelled");
  });

  it.each(["used", "not_yours"])("sends a %s return to Settings with that status", async (status) => {
    finishCardSession.mockResolvedValue(status);
    expect(where(await get())).toBe(`/settings/paying?card=${status}`);
  });

  it("sends a return with no session id, or with Stripe off here, to Settings", async () => {
    expect(where(await get(""))).toBe("/settings/paying?card=not_yours");
    stripeWiring.mockResolvedValue(null);
    expect(where(await get())).toBe("/settings/paying?card=unavailable");
    expect(finishCardSession).not.toHaveBeenCalled();
  });

  it("sends the buyer to Settings when Stripe can't be reached", async () => {
    finishCardSession.mockRejectedValue(Object.assign(new Error("Stripe read_session failed (503)"), { kind: "unavailable" }));
    expect(where(await get())).toBe("/settings/paying?card=error");
  });
});
