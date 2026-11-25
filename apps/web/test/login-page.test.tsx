import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const { default: LoginPage } = await import("@/app/auth/login/page");
const { default: SignUpPage } = await import("@/app/auth/sign-up/page");
const { default: SignUpSuccessPage } = await import("@/app/auth/sign-up-success/page");

const SHARE = "/share/11111111-2222-4333-8444-555555555555";

// The form reads the address, so it's an async server component inside the page.
async function show(Page: typeof LoginPage | typeof SignUpPage, next?: string) {
  const props = { params: Promise.resolve({}), searchParams: Promise.resolve(next ? { next } : {}) };
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <Suspense>
        <Page {...props} />
      </Suspense>,
    ));
  });
  await screen.findByRole("button", { name: "Continue with Google" });
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

  it("the confirmation link can be opened on any device", () => {
    const { container } = render(<SignUpSuccessPage />);
    expect(container).toHaveTextContent("We sent you a link to confirm your account. Open it to finish signing up.");
  });
});
