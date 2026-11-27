import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// What we know on its own page (ALL-186): back to the person, the add box, the questions
// link whenever questions are open, then the list as it was. The list and the box have their
// own tests; here they're stand-ins.

vi.mock("server-only", () => ({}));
const getPerson = vi.hoisted(() => vi.fn());
const getProfile = vi.hoisted(() => vi.fn());
const readAccess = vi.hoisted(() => vi.fn(async () => ({ access: true, requested: false }) as { access: boolean; requested: boolean } | null));
vi.mock("@/modules/concierge", () => ({ getPerson, getProfile }));
vi.mock("@/components/concierge-gate", () => ({ readAccess }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("../../actions", () => {
  const action = async () => ({ ok: true });
  return { addFactAction: action, deleteFactAction: action, editFactAction: action, readCapturesAction: action, setFactActiveAction: action };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
  usePathname: () => "/people/p1/know",
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/components/app-shell/back-history", () => ({
  BackLink: ({ href, label }: { href: string; label: string }) => <a href={href}>‹ {label}</a>,
}));
vi.mock("../know/add-fact", () => ({ AddFact: ({ personId }: { personId: string }) => <p>Add box for {personId}</p> }));
vi.mock("../what-we-know", () => ({
  WhatWeKnow: ({ knowledge, hasAccess }: { knowledge: { groups: unknown[] }; hasAccess: boolean }) => (
    <p>
      List of {knowledge.groups.length} groups, access {String(hasAccess)}
    </p>
  ),
}));

const knowPage = await import("../know/page");

function loaded(node: ReactNode): ReactElement<Record<string, unknown>> {
  const stack: ReactNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (isValidElement<{ children?: ReactNode }>(n)) {
      if (typeof n.type === "function" && n.type.name === "Loaded") return n as ReactElement<Record<string, unknown>>;
      stack.push(n.props.children);
    }
  }
  throw new Error("No Loaded component in the page");
}

async function show() {
  const el = loaded(knowPage.default({ params: Promise.resolve({ id: "p1" }) }));
  render((await (el.type as (props: unknown) => Promise<ReactElement>)(el.props)) as ReactElement);
}

const dad = { id: "p1", name: "Dad", keepsList: true };
const profile = (over: Record<string, unknown> = {}) => ({
  groups: [{ category: "interest", label: "Interests", facts: [{ id: "f1" }] }],
  off: [],
  unread: 0,
  captureRead: null,
  openCount: 0,
  readiness: null,
  ...over,
});

describe("What we know page", () => {
  beforeEach(() => {
    getPerson.mockResolvedValue(dad);
    getProfile.mockResolvedValue(profile());
  });

  it("goes back to the person, titled What we know, with the add box above the list", async () => {
    await show();
    expect(screen.getByRole("link", { name: "‹ Dad" })).toHaveAttribute("href", "/people/p1");
    expect(screen.getByRole("heading", { level: 1, name: "What we know" })).toBeInTheDocument();
    const box = screen.getByText("Add box for p1");
    const list = screen.getByText("List of 1 groups, access true");
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getProfile.mock.calls[0].slice(1)).toEqual(["p1", true]);
  });

  it("offers more questions whenever some are open, not only when nothing is known", async () => {
    getProfile.mockResolvedValue(profile({ openCount: 2 }));
    await show();
    expect(screen.getByRole("link", { name: "Answer more questions" })).toHaveAttribute("href", "/people/p1/questions");
  });

  it("says a few questions when nothing is known yet", async () => {
    getProfile.mockResolvedValue(profile({ groups: [], openCount: 5 }));
    await show();
    expect(screen.getByRole("link", { name: "Answer a few questions" })).toHaveAttribute("href", "/people/p1/questions");
  });

  it("has no questions link when none are open", async () => {
    await show();
    expect(screen.queryByRole("link", { name: /questions/ })).toBeNull();
  });

  it("hides the concierge's parts when the access check fails", async () => {
    readAccess.mockResolvedValueOnce(null);
    await show();
    expect(screen.getByText("List of 1 groups, access false")).toBeInTheDocument();
  });

  it("is a 404 for a person who isn't found", async () => {
    getPerson.mockResolvedValue(null);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // "Read them now" reads captures with AI one after another, which can run long.
  it("keeps 300 s for reading captures", () => {
    expect(knowPage.maxDuration).toBe(300);
  });
});
