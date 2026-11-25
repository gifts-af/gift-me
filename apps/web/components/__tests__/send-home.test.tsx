import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real access check runs; only the database client is faked here.
// open-signup.spec.ts runs it against the real database.
const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("server-only", () => ({}));
const lastTab = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "home_tab" && lastTab.value ? { value: lastTab.value } : undefined) }),
}));

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
  lastTab.value = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.mocked(console.log).mockRestore();
});

describe("SendHome", () => {
  it.each<[string, string | null, Reply, string | undefined, string]>([
    ["My list on a new browser, even with access", "u1", row(true), undefined, "/lists"],
    ["Give when it was the last tab used", "u1", row(true), "give", "/give"],
    ["Give when it was the last tab used, without concierge access too", "u1", row(false), "give", "/give"],
    ["My list when it was the last tab used", "u1", row(true), "get", "/lists"],
    ["My list without (AC-3)", "u1", row(false), undefined, "/lists"],
    ["My list with no account row (AC-3)", "u1", { data: null, error: null }, undefined, "/lists"],
    ["sign-in with no session", null, row(true), undefined, "/auth/login"],
  ])("goes to %s", async (_, userId, reply, tab, to) => {
    lastTab.value = tab;
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
