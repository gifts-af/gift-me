import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A person's Their list page (ALL-123): sends you to the share page.

vi.mock("server-only", () => ({}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../actions", () => ({ linkListAction: vi.fn(), unlinkListAction: vi.fn() }));
vi.mock("../list-link", () => ({ ListLink: () => null }));
vi.mock("@/components/app-shell/app-nav", () => ({ AppNav: () => null }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
const getPerson = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", () => ({ getPerson }));
const getPersonShareToken = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lists", () => ({ getPersonShareToken }));
const appSettingInt = vi.hoisted(() => vi.fn());
vi.mock("@/lib/app-settings", () => ({ appSettingInt }));

const listPage = await import("../list/page");

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

async function open() {
  const el = loaded(listPage.default({ params: Promise.resolve({ id: "p1" }) }));
  return (el.type as (props: unknown) => Promise<unknown>)(el.props);
}

describe("a person's Their list page", () => {
  beforeEach(() => {
    redirect.mockClear();
    getPerson.mockResolvedValue({ id: "p1", name: "Sam", keepsList: true });
    getPersonShareToken.mockResolvedValue(null);
    appSettingInt.mockResolvedValue(1);
  });

  it("redirects to the share page when the person has a linked list", async () => {
    getPersonShareToken.mockResolvedValue("tok");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT /share/tok");
  });

  it("redirects to the person when there's no list and the card is on", async () => {
    await expect(open()).rejects.toThrow("NEXT_REDIRECT /people/p1");
  });

  it("still shows the link form when the card is off", async () => {
    appSettingInt.mockResolvedValue(0);
    await expect(open()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
