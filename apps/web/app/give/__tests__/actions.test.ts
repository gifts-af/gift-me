import { beforeEach, describe, expect, it, vi } from "vitest";

// Who the request is for, and what the action does with a refusal. The database
// and the emails are covered by concierge-request.test.ts and open-signup.spec.ts.
const m = vi.hoisted(() => ({ refresh: vi.fn(), getClaims: vi.fn(), profile: vi.fn(), eq: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: m.getClaims },
    from: () => ({ select: () => ({ eq: m.eq.mockImplementation(() => ({ single: m.profile })) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ schema: () => ({ rpc: m.rpc }) }) }));
vi.mock("@/modules/concierge", async (original) => ({
  ...(await original<typeof import("@/modules/concierge")>()),
  defaultChannels: () => [{ name: "email", send: m.send }],
}));

import { requestAccessAction } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  m.profile.mockResolvedValue({ data: { display_name: "Jordan", email: "jordan@example.test" }, error: null });
  m.rpc.mockResolvedValue({ data: "claimed", error: null });
  m.send.mockResolvedValue({ ok: true, id: "1" });
});

describe("requestAccessAction", () => {
  it("takes the person from the session, sends both emails, and shows the sent page", async () => {
    expect(requestAccessAction).toHaveLength(0);
    expect(await requestAccessAction()).toEqual({ status: "sent" });
    expect(m.eq).toHaveBeenCalledWith("id", "u1");
    expect(m.rpc).toHaveBeenCalledWith("claim_access_request", { p_user_id: "u1" });
    expect(m.send.mock.calls.map(([e]) => [e.to, e.replyTo])).toEqual([
      ["allensforever711+access@gmail.com", "jordan@example.test"],
      ["jordan@example.test", undefined],
    ]);
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("releases the claim when the owner's email fails", async () => {
    m.send.mockResolvedValue({ ok: false, error: "down" });
    expect(await requestAccessAction()).toEqual({ status: "error" });
    expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_access_request", "release_access_request"]);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("says sent, with no email, to someone who already asked", async () => {
    m.rpc.mockResolvedValue({ data: "already", error: null });
    expect(await requestAccessAction()).toEqual({ status: "sent" });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("says busy, with no email, once today's requests are used up", async () => {
    m.rpc.mockResolvedValue({ data: "busy", error: null });
    expect(await requestAccessAction()).toEqual({ status: "busy" });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("says it didn't send, and logs ids only, when the owner's email and then the release fail", async () => {
    m.send.mockResolvedValue({ ok: false, error: "jordan@example.test" });
    m.rpc.mockImplementation(async (name: string) =>
      name === "claim_access_request" ? { data: "claimed", error: null } : { data: null, error: { message: "jordan@example.test" } },
    );
    expect(await requestAccessAction()).toEqual({ status: "error" });
    expect(m.refresh).not.toHaveBeenCalled();
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.map((line) => JSON.parse(line).event)).toEqual(["concierge_access.request_email_failed", "concierge_access.request_failed"]);
    expect(logged.join()).not.toContain("jordan");
  });

  it.each([
    ["no session", () => m.getClaims.mockResolvedValue({ data: null, error: null })],
    ["a failed sign-in check", () => m.getClaims.mockResolvedValue({ data: null, error: { message: "down" } })],
    ["a failed profile read", () => m.profile.mockResolvedValue({ data: null, error: { message: "down" } })],
    ["a profile with no email", () => m.profile.mockResolvedValue({ data: { display_name: "Jordan", email: null }, error: null })],
  ])("refuses with %s: no claim, no email", async (_, arrange) => {
    arrange();
    expect(await requestAccessAction()).toEqual({ status: "error" });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("logs ids only when the claim fails", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "jordan@example.test" } });
    expect(await requestAccessAction()).toEqual({ status: "error" });
    const logged = String(vi.mocked(console.log).mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "concierge_access.request_failed", user_id: "u1" });
    expect(logged).not.toContain("jordan");
    expect(m.send).not.toHaveBeenCalled();
  });
});
