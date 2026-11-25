import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const { default: LoginPage } = await import("@/app/auth/login/page");
const { default: SignUpPage } = await import("@/app/auth/sign-up/page");
const { default: SignUpSuccessPage } = await import("@/app/auth/sign-up-success/page");

const { default: ForgotPasswordPage } = await import("@/app/auth/forgot-password/page");
const { default: AuthErrorPage } = await import("@/app/auth/error/page");

const SHARE = "/share/11111111-2222-4333-8444-555555555555";

type AuthPage = (props: { params: Promise<object>; searchParams: Promise<Record<string, string | string[] | undefined>> }) => React.ReactNode;

// The form reads the address, so it's an async server component inside the page.
async function show(Page: AuthPage, next?: string) {
  const container = await showPage(Page, next);
  await screen.findByRole("button", { name: "Continue with Google" });
  return container;
}

async function showPage(Page: AuthPage, next?: string) {
  const props = { params: Promise.resolve({}), searchParams: Promise.resolve(next ? { next } : {}) };
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <Suspense>
        <Page {...props} />
      </Suspense>,
    ));
  });
  return container;
}

describe("sign-in and sign-up pages (AC-2)", () => {
  it.each([
    ["sign-in", LoginPage],
    ["sign-up", SignUpPage],
  ])("%s says nothing about invites or asking for access", async (_name, Page) => {
    expect(await show(Page)).not.toHaveTextContent(/invite|request access/i);
  });

  it("sign-in leads to sign-up, and keeps the list to come back to", async () => {
    await show(LoginPage, SHARE);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      `/auth/sign-up?next=${encodeURIComponent(SHARE)}`,
    );
  });

  it("sign-up leads to sign-in, and keeps the list to come back to", async () => {
    await show(SignUpPage, SHARE);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/auth/login?next=${encodeURIComponent(SHARE)}`);
  });

  it("sign-in's forgot-password link keeps the list, and so does the way back", async () => {
    await show(LoginPage, SHARE);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      `/auth/forgot-password?next=${encodeURIComponent(SHARE)}`,
    );
    await showPage(ForgotPasswordPage, SHARE);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", `/auth/login?next=${encodeURIComponent(SHARE)}`);
  });

  it("sign-up says what it's for, and links home and to Privacy", async () => {
    expect(await show(SignUpPage)).toHaveTextContent(
      "Free. Make a wish list, share one link, and keep your family's lists in one place.",
    );
    expect(screen.getByRole("link", { name: /GiftsAF/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});

// Supabase sends nothing when the address already has an account, and doesn't
// say so, so the page has a way on for both.
describe("after signing up", () => {
  it.each([
    [SHARE, `?next=${encodeURIComponent(SHARE)}`],
    [undefined, ""],
    ["//evil.example", ""],
  ])("next %s: says what to do, with ways to sign in or go back", async (next, query) => {
    const container = await showPage(SignUpSuccessPage, next);
    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(container).toHaveTextContent(
      "Check your email for a link to confirm your account. Nothing after a few minutes? Check spam. If you already have an account, sign in.",
    );
    expect(screen.getByRole("link", { name: "sign in" })).toHaveAttribute("href", `/auth/login${query}`);
    expect(screen.getByRole("link", { name: "Back to sign-up" })).toHaveAttribute("href", `/auth/sign-up${query}`);
  });
});

describe("the sign-in error page", () => {
  it.each([
    [SHARE, `?next=${encodeURIComponent(SHARE)}`],
    ["//evil.example", ""],
  ])("Try again keeps next %s", async (next, query) => {
    await showPage(AuthErrorPage, next);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", `/auth/login${query}`);
  });
});
