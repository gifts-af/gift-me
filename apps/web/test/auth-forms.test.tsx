import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Typing or autofill can land before the page's JavaScript loads (slow phones,
// iPhone Keychain). Found by the iPhone e2e run (ALL-60): the email was wiped,
// and a tap on Sign in that early would send the password in the page address.
const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
