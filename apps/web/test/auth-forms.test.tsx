import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "@/lib/safe-next";

// Typing or autofill can land before the page's JavaScript loads (slow phones,
// iPhone Keychain). Found by the iPhone e2e run (ALL-60): the email was wiped,
// and a tap on Sign in that early would send the password in the page address.
const push = vi.fn();
const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const { LoginForm } = await import("@/components/login-form");
const { SignUpForm } = await import("@/components/sign-up-form");
const { ForgotPasswordForm } = await import("@/components/forgot-password-form");
const { UpdatePasswordForm } = await import("@/components/update-password-form");

// Sets a field the way autofill or pre-load typing does: no React change event.
function prefill(label: string, value: string) {
  (screen.getByLabelText(label) as HTMLInputElement).value = value;
}

describe("auth forms keep what was typed before the page loaded", () => {
  beforeEach(() => {
    for (const fn of Object.values(auth)) fn.mockReset().mockResolvedValue({ error: { message: "stop here" } });
  });

  it("sign in uses the email and password already in the fields", async () => {
    render(<LoginForm />);
    prefill("Email", "sam@example.com");
    prefill("Password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "sam@example.com",
        password: "pw-123456",
        options: { captchaToken: "test-token" },
      }),
    );
  });

  it("sign up uses the fields already filled in", async () => {
    render(<SignUpForm />);
    prefill("Email", "sam@example.com");
    prefill("Password", "pw-123456");
    prefill("Repeat password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: /sign up|create/i }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalled());
    expect(auth.signUp.mock.calls[0][0]).toMatchObject({ email: "sam@example.com", password: "pw-123456" });
    expect(auth.signUp.mock.calls[0][0].options.captchaToken).toBe("test-token");
  });

  it("forgot password uses the email already in the field", async () => {
    render(<ForgotPasswordForm />);
    prefill("Email", "sam@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalled());
    expect(auth.resetPasswordForEmail.mock.calls[0][0]).toBe("sam@example.com");
    expect(auth.resetPasswordForEmail.mock.calls[0][1].captchaToken).toBe("test-token");
  });

  it("update password uses the password already in the field", async () => {
    render(<UpdatePasswordForm />);
    prefill("New password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "pw-123456" }));
  });
});

// From a shared list, sign-up comes back to it: through Google's return address,
// and through the emailed link, whose template passes this address to
// /auth/confirm. Both are full addresses on this site, which Supabase's list of
// allowed redirects takes.
describe("sign up from a shared list", () => {
  const SHARE = "/share/11111111-2222-4333-8444-555555555555";
  const signUp = () => {
    prefill("Email", "sam@example.com");
    prefill("Password", "pw-123456");
    prefill("Repeat password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  };
  beforeEach(() => {
    for (const fn of Object.values(auth)) fn.mockReset().mockResolvedValue({ error: { message: "stop here" } });
  });

  it.each([
    [SHARE, SHARE],
    [undefined, "/"],
    ["https://evil.example/share/x", "/"],
    ["//evil.example", "/"],
  ])("by email, next %s comes back to %s", async (next, back) => {
    render(<SignUpForm next={next} />);
    signUp();
    await waitFor(() => expect(auth.signUp).toHaveBeenCalled());
    const { emailRedirectTo } = auth.signUp.mock.calls[0][0].options;
    expect(emailRedirectTo).toBe(`${window.location.origin}${back}`);
    // What /auth/confirm makes of it.
    expect(safeNext(emailRedirectTo, window.location.origin)).toBe(back);
  });

  it.each([
    [SHARE, `?next=${encodeURIComponent(SHARE)}`],
    ["//evil.example", ""],
  ])("then says to check the email, keeping next %s", async (next, query) => {
    auth.signUp.mockResolvedValue({ error: null });
    render(<SignUpForm next={next} />);
    signUp();
    await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/auth/sign-up-success${query}`));
  });

  it("by Google, comes back to the list", async () => {
    render(<SignUpForm next={SHARE} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalled());
    const back = new URL(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(back.origin + back.pathname).toBe(`${window.location.origin}/auth/callback`);
    expect(back.searchParams.get("next")).toBe(SHARE);
  });
});

// The name shows on the owner's shared list as well as on claims (ALL-123).
describe("sign up's name hint", () => {
  it("says where the name is shown", () => {
    render(<SignUpForm />);
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription(
      "Shown on your shared list, and to anyone who opens a list you claim from.",
    );
  });
});

// Supabase's own words never reach the page.
describe("sign-in and sign-up errors are in our words", () => {
  const RAW = "raw Supabase text";
  beforeEach(() => {
    for (const fn of Object.values(auth)) fn.mockReset();
  });
  const alert = async () => (await screen.findByRole("alert")).textContent;

  it.each([
    ["over_email_send_rate_limit", "We can't send another email right now. Try again a bit later, or sign in with Google."],
    ["user_already_exists", "You already have an account with this email. Sign in instead."],
    ["email_exists", "You already have an account with this email. Sign in instead."],
    ["weak_password", "That password is too easy to guess. Try a longer one, with letters, numbers and symbols."],
    ["over_request_rate_limit", "Too many tries. Wait a few minutes, then try again."],
    ["toString", "Something went wrong. Please try again in a minute."],
    [undefined, "Something went wrong. Please try again in a minute."],
  ])("sign up, %s", async (code, words) => {
    auth.signUp.mockResolvedValue({ error: { code, message: RAW } });
    render(<SignUpForm />);
    prefill("Email", "sam@example.com");
    prefill("Password", "pw-123456");
    prefill("Repeat password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await alert()).toBe(words);
  });

  it.each([
    ["email_not_confirmed", "Confirm your email first: open the link we sent you."],
    ["invalid_credentials", "That email and password don't match. Try again, reset your password below, or use Continue with Google."],
    ["unexpected_failure", "Something went wrong. Please try again in a minute."],
  ])("sign in, %s", async (code, words) => {
    auth.signInWithPassword.mockResolvedValue({ error: { code, message: RAW } });
    render(<LoginForm />);
    prefill("Email", "sam@example.com");
    prefill("Password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await alert()).toBe(words);
  });

  it("forgot password", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "over_email_send_rate_limit", message: RAW } });
    render(<ForgotPasswordForm />);
    prefill("Email", "sam@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await alert()).toBe("We can't send another email right now. Try again a bit later, or sign in with Google.");
  });

  it.each([
    ["same_password", "That's your current password. Choose a different one."],
    ["weak_password", "That password is too easy to guess. Try a longer one, with letters, numbers and symbols."],
    [undefined, "Something went wrong. Please try again in a minute."],
  ])("update password, %s", async (code, words) => {
    auth.updateUser.mockResolvedValue({ error: { code, message: RAW } });
    render(<UpdatePasswordForm />);
    prefill("New password", "pw-123456");
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await alert()).toBe(words);
  });

  it("Continue with Google", async () => {
    auth.signInWithOAuth.mockResolvedValue({ error: { message: RAW } });
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await alert()).toBe("Something went wrong. Please try again in a minute.");
  });
});

describe("before the page loads, the forms can't be sent", () => {
  it.each([
    ["sign in", () => <LoginForm />],
    ["sign up", () => <SignUpForm />],
    ["forgot password", () => <ForgotPasswordForm />],
    ["update password", () => <UpdatePasswordForm />],
  ])("%s: the server-rendered submit button is disabled and the form posts", (_name, make) => {
    const html = renderToString(make());
    const form = new DOMParser().parseFromString(html, "text/html").querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
  });
});
