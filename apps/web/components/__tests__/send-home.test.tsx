import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real access check runs; only the database client is faked here.
// open-signup.spec.ts runs it against the real database.
const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("server-only", () => ({}));

import { SendHome } from "../home/send-home";

type Reply = { data: { concierge_access: boolean; access_requested_at: null } | null; error: { message: string } | null };

function client(userId: string | null, reply: Reply, claimsError: { message: string } | null = null) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => reply };
  createClient.mockResolvedValue({
    auth: { getClaims: async () => ({ data: userId ? { claims: { sub: userId } } : null, error: claimsError }) },
    schema: () => ({ from: () => query }),
  });
}
const row = (access: boolean): Reply => ({ data: { concierge_access: access, access_requested_at: null }, error: null });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.mocked(console.log).mockRestore();
});

describe("SendHome", () => {
  it.each<[string, string | null, Reply, string]>([
    ["Give with access (AC-9)", "u1", row(true), "/give"],
    ["My list without (AC-3)", "u1", row(false), "/lists"],
    ["My list with no account row (AC-3)", "u1", { data: null, error: null }, "/lists"],
    ["sign-in with no session", null, row(true), "/auth/login"],
  ])("goes to %s", async (_, userId, reply, to) => {
    client(userId, reply);
    await expect(SendHome()).rejects.toMatchObject({ digest: expect.stringContaining(`;${to};`) });
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each<[string, string | null, Reply, { message: string } | null]>([
    ["the access check", "u1", { data: null, error: { message: "down" } }, null],
    ["the sign-in check", null, row(true), { message: "down" }],
  ])("shows the retry line, and goes nowhere, when %s fails (AC-13)", async (_, userId, reply, claimsError) => {
    client(userId, reply, claimsError);
    render(await SendHome());
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this. Refresh to try again.");
    expect(console.log).toHaveBeenCalledOnce();
  });
});
