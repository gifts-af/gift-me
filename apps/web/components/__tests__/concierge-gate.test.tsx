import { cleanup, render, screen } from "@testing-library/react";
import { isHangingPromiseRejectionError, makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gate runs the real access check; only the database client is faked here.
// open-signup.spec.ts runs it against the real database.
const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("server-only", () => ({}));

import { ConciergeGate } from "../concierge-gate";
import { ConciergePitch } from "../home/concierge-pitch";

type Reply = { data: { concierge_access: boolean; access_requested_at: string | null } | null; error: { message: string } | null };

function client(userId: string | null, reply: Reply) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => reply };
  createClient.mockResolvedValue({
    auth: { getClaims: async () => ({ data: userId ? { claims: { sub: userId } } : null, error: null }) },
    schema: () => ({ from: () => query }),
  });
}
const row = (access: boolean, requestedAt: string | null = null): Reply => ({
  data: { concierge_access: access, access_requested_at: requestedAt },
  error: null,
});

const child = vi.fn(() => <p>Page content</p>);
const Child = () => child();
async function show() {
  render(await ConciergeGate({ children: <Child /> }));
}

beforeEach(() => {
  child.mockClear();
  createClient.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.mocked(console.log).mockRestore();
});

describe("ConciergeGate", () => {
  it("shows the page to someone with access", async () => {
    client("u1", row(true));
    await show();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(screen.queryByText("Gifting, handled AF.")).toBeNull();
  });

  it.each<[string, Reply]>([
    ["access off", row(false)],
    ["no account row", { data: null, error: null }],
  ])("shows the pitch, and never runs the page, with %s (AC-5)", async (_, reply) => {
    client("u1", reply);
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Gifting, handled AF." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Take the tour" })).toHaveAttribute("href", "/tour");
    expect(child).not.toHaveBeenCalled();
  });

  it("says the request was sent to someone who asked", async () => {
    client("u1", row(false, "2026-11-25T12:00:00Z"));
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "You asked for access" })).toBeInTheDocument();
    expect(screen.getByText("Request sent")).toBeInTheDocument();
    expect(screen.getByText("We're letting people in a few at a time. We'll email you when you're in.")).toBeInTheDocument();
    expect(screen.getByText("Your list is ready to share in the meantime.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to my list" })).toHaveAttribute("href", "/lists");
    expect(screen.getByRole("link", { name: "Take the tour" })).toHaveAttribute("href", "/tour");
    expect(screen.queryByRole("button")).toBeNull();
    expect(child).not.toHaveBeenCalled();
  });

  it("shows a retry line when the check fails: not the page, not the pitch (AC-13)", async () => {
    client("u1", { data: null, error: { message: "secret detail" } });
    await show();
    expect(screen.getByText("We couldn't load this. Refresh to try again.")).toBeInTheDocument();
    expect(child).not.toHaveBeenCalled();
    expect(screen.queryByText("Gifting, handled AF.")).toBeNull();
    expect(screen.queryByText("Request access")).toBeNull();
    expect(console.log).toHaveBeenCalledOnce();
    const logged = String(vi.mocked(console.log).mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "concierge_access.check_failed", user_id: "u1" });
    expect(logged).not.toContain("secret detail");
  });

  it("puts the pitch and the retry line, but not the page, in the frame it's given", async () => {
    const frame = (notice: React.ReactNode) => <main>{notice}</main>;
    client("u1", row(false));
    render(await ConciergeGate({ frame, children: <Child /> }));
    expect(screen.getByRole("main")).toHaveTextContent("Gifting, handled AF.");
    cleanup();
    client("u1", { data: null, error: { message: "down" } });
    render(await ConciergeGate({ frame, children: <Child /> }));
    expect(screen.getByRole("main")).toHaveTextContent("We couldn't load this.");
    cleanup();
    client("u1", row(true));
    render(await ConciergeGate({ frame, children: <Child /> }));
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("sends a signed-out visitor to sign in", async () => {
    client(null, row(true));
    await expect(ConciergeGate({ children: <Child /> })).rejects.toMatchObject({
      digest: expect.stringContaining("/auth/login"),
    });
    expect(child).not.toHaveBeenCalled();
  });

  it("passes Next's end-of-prerender rejection on and logs nothing", async () => {
    createClient.mockImplementation(() => makeUntrackedHangingPromise(AbortSignal.abort(), "/people/new", "`cookies()`"));
    const error = await ConciergeGate({ children: <Child /> }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isHangingPromiseRejectionError(error)).toBe(true);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe("ConciergePitch", () => {
  it("shows the request button it's given, until the request is sent", () => {
    const button = <button>Request access</button>;
    const { rerender } = render(<ConciergePitch requested={false} requestButton={button} />);
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    rerender(<ConciergePitch requested requestButton={button} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
