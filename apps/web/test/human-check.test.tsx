import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnstileMock } from "./turnstile-mock";

// ALL-68: Cloudflare's widget (stood in for by test/turnstile-mock.tsx) must
// hand over a token before a public form can be sent.
const auth = { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), signInWithOAuth: vi.fn() };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: vi.fn(async () => ({ status: "error", message: "Try again" })) }));
vi.mock("@/app/feedback/actions", () => ({ submitFeedback: vi.fn() }));
const { LoginForm } = await import("@/components/login-form");
const { SignUpForm } = await import("@/components/sign-up-form");
const { ForgotPasswordForm } = await import("@/components/forgot-password-form");
const { RequestAccessForm } = await import("@/app/request-access/request-access-form");
const { FeedbackButton } = await import("@/components/home/feedback-dialog");
const { HumanCheck } = await import("@/components/human-check");

afterEach(() => {
  turnstileMock.autoToken = true;
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
});

describe("the bot check on public forms", () => {
  it.each([
    ["sign in", () => <LoginForm />, "Sign in"],
    ["sign up", () => <SignUpForm />, "Create account"],
    ["forgot password", () => <ForgotPasswordForm />, "Send reset link"],
    ["request access", () => <RequestAccessForm />, "Request access"],
  ])("%s can't be sent until the check hands over a token", async (_name, form, button) => {
    turnstileMock.autoToken = false;
    render(form());
    await waitFor(() => expect(screen.getByRole("button", { name: button })).toBeDisabled());
  });

  it("feedback can't be sent until the check hands over a token", async () => {
    turnstileMock.autoToken = false;
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /send/i, hidden: false })).toBeInTheDocument());
    const submit = screen.getAllByRole("button").find((b) => b.getAttribute("type") === "submit")!;
    expect(submit).toBeDisabled();
  });

  it("request access sends the token in the form", async () => {
    const { container } = render(<RequestAccessForm />);
    await waitFor(() =>
      expect(container.querySelector('form input[name="cf-turnstile-response"]')).toHaveValue("test-token"),
    );
  });

  it("gets a fresh token after a failed sign in, since each one works once", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw-123456" } });
    const before = turnstileMock.renders;
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in" })));
    await screen.findByText("Invalid login credentials");
    expect(turnstileMock.renders).toBeGreaterThan(before);
  });

  it("gets a fresh token after request access answers", async () => {
    render(<RequestAccessForm />);
    const before = turnstileMock.renders;
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jordan" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Request access" })).toBeEnabled());
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Request access" }).closest("form")!));
    await screen.findByText("Try again");
    expect(turnstileMock.renders).toBeGreaterThan(before);
  });

  it("says plainly when the site key isn't set, instead of failing quietly", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    render(<HumanCheck onToken={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/bot check isn't set up/i);
  });
});
