import { beforeEach, describe, expect, it, vi } from "vitest";

// open-signup.spec.ts runs this refusal against the real database.
const m = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: m.getClaims }, schema: () => ({ rpc: m.rpc }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/wiring", () => ({ placeHeld: vi.fn(), zincWiring: vi.fn() }));
vi.mock("@/modules/concierge", async (original) => ({
  ...(await original<typeof import("@/modules/concierge")>()),
  createSupabaseNotifyStore: () => ({}),
  defaultChannels: () => [],
  sendTestNotification: m.send,
}));

import { sendTestEmail } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.send.mockResolvedValue({ ok: true });
});

describe("sendTestEmail", () => {
  it("sends with access", async () => {
    expect(await sendTestEmail()).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("has_concierge_access", { p_user_id: "u1" });
    expect(m.send).toHaveBeenCalledWith("u1", expect.anything());
  });

  it.each([
    ["without access (AC-16)", () => m.rpc.mockResolvedValue({ data: false, error: null })],
    ["when the access check fails", () => m.rpc.mockResolvedValue({ data: null, error: { message: "down" } })],
    ["when the sign-in check fails", () => m.getClaims.mockResolvedValue({ data: null, error: { message: "down" } })],
    ["with no session", () => m.getClaims.mockResolvedValue({ data: null, error: null })],
  ])("refuses and sends nothing %s", async (_, arrange) => {
    arrange();
    expect(await sendTestEmail()).toEqual({ ok: false, error: expect.any(String) });
    expect(m.send).not.toHaveBeenCalled();
  });
});
