import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth } }) }));
const { GoogleButton } = await import("@/components/google-button");

describe("GoogleButton", () => {
  beforeEach(() => {
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ error: null });
  });

  it("passes the owner's email to Google as login_hint (ALL-23, AC-7)", async () => {
    render(<GoogleButton next="/a/tok" loginHint="sam@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    const { options } = signInWithOAuth.mock.calls[0][0];
    expect(options.queryParams).toEqual({ login_hint: "sam@example.com" });
    expect(options.redirectTo).toContain(`next=${encodeURIComponent("/a/tok")}`);
  });

  it("sends no hint when there isn't one", async () => {
    render(<GoogleButton />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(signInWithOAuth.mock.calls[0][0].options.queryParams).toBeUndefined();
  });
});
