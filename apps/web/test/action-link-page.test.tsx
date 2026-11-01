import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LinkView } from "@/modules/concierge";

// The page module pulls in the server-only store; only its metadata is read here.
vi.mock("server-only", () => ({}));
vi.mock("@/app/a/[token]/actions", () => ({ confirmLink: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { ActionLinkView } = await import("@/app/a/[token]/link-view");
const { LinkState } = await import("@/app/a/[token]/link-states");
const { metadata } = await import("@/app/a/[token]/page");

const TOKEN = "tok123";
const show = (view: LinkView) => render(<ActionLinkView view={view} token={TOKEN} />);

function expectHomeLink() {
  expect(screen.getByRole("link", { name: "Go to GiftsAF" })).toHaveAttribute("href", "/");
}

describe("/a/[token] page (ALL-23)", () => {
  it("keeps the page out of search and the token out of Referer headers", () => {
    expect(metadata.robots).toMatchObject({ index: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("asks a signed-out visitor to sign in and come back (AC-7)", () => {
    show({ state: "sign_in", email: "sam@example.com" });
    expect(screen.getByRole("heading", { name: "Sign in to continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    const email = screen.getByRole("link", { name: "Sign in with email" });
    const url = new URL(email.getAttribute("href")!, "https://app.test");
    expect(url.pathname).toBe("/auth/login");
    expect(url.searchParams.get("next")).toBe(`/a/${TOKEN}`);
  });

  it("tells someone on another account, and offers to switch (AC-8)", () => {
    show({ state: "wrong_account" });
    expect(screen.getByRole("heading", { name: "This link is for a different account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in as someone else" })).toBeInTheDocument();
    expectHomeLink();
  });

  it.each([
    [{ state: "used" } as const, "This link has already been used"],
    [{ state: "expired" } as const, "This link has expired"],
    [{ state: "invalid" } as const, "This link doesn't work"],
  ])("shows %o as %s with a way into the app (AC-5, AC-6, AC-9)", (view, heading) => {
    show(view);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expectHomeLink();
    expect(document.querySelector("form")).toBeNull();
  });

  it("after the POST, says what was done in the action's words and links home (AC-10)", () => {
    render(<LinkState view={{ state: "done", done: { title: "Done", body: "It works." } }} token={TOKEN} />);
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("It works.")).toBeInTheDocument();
    expectHomeLink();
  });

  it("shows the action and one submit button that posts (AC-3, AC-4)", () => {
    const { container } = show({
      state: "confirm",
      confirm: { title: "Try the test button", body: "Confirm here.", button: "Try it" },
    });
    expect(screen.getByRole("heading", { name: "Try the test button" })).toBeInTheDocument();
    expect(screen.getByText("Confirm here.")).toBeInTheDocument();
    const form = container.querySelector("form")!;
    expect(form).not.toBeNull();
    const buttons = form.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("type", "submit");
    expect(buttons[0]).toHaveTextContent("Try it");
  });
});
