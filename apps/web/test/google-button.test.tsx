import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

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

  // ALL-110: the button is in the server's HTML of sign-in, sign-up and the
  // /a/[token] pages. A tap before the page's JavaScript has loaded does
  // nothing, so it looks not ready until then.
  it("is marked not ready in the server's HTML, then signs in on the first tap", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => container.remove());
    container.innerHTML = renderToString(<GoogleButton />);
    const button = () => within(container).getByRole("button", { name: "Continue with Google" });
    expect(button()).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, not disabled: a keyboard can still reach it.
    expect(button()).toBeEnabled();

    await act(async () => {
      render(<GoogleButton />, { container, hydrate: true });
    });
    expect(button()).not.toHaveAttribute("aria-disabled");

    fireEvent.click(button());
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledOnce());
  });
});
