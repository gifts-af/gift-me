import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A person's Their list page (ALL-123): sends you to the share page while the
// card is on (list_link_card_enabled = 1); at 0 it's the old link screen, for
// linked and unlinked people alike, so a linked person can still be unlinked.

vi.mock("server-only", () => ({}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../actions", () => ({ linkListAction: vi.fn(), unlinkListAction: vi.fn() }));
const ListLink = vi.hoisted(() => function ListLink() {
  return null;
});
vi.mock("../list-link", () => ({ ListLink }));
vi.mock("@/components/app-shell/app-nav", () => ({ AppNav: () => null }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
const getPerson = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", () => ({ getPerson }));
const getPersonShareToken = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lists", () => ({ getPersonShareToken }));
const appSettingInt = vi.hoisted(() => vi.fn());
const readAccess = vi.hoisted(() => vi.fn());
vi.mock("@/components/concierge-gate", () => ({ readAccess }));
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

function findListLink(node: ReactNode): Record<string, unknown> | null {
  const stack: ReactNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (isValidElement<{ children?: ReactNode }>(n)) {
      if (n.type === ListLink) return n.props as Record<string, unknown>;
      stack.push(n.props.children);
    }
  }
  return null;
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
    readAccess.mockResolvedValue({ access: true, requested: false });
  });

  it("redirects to the share page when the person has a linked list and the card is on", async () => {
    getPersonShareToken.mockResolvedValue("tok");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT /share/tok");
    expect(appSettingInt).toHaveBeenCalledWith("list_link_card_enabled");
  });

  it("redirects to the person when there's no list and the card is on", async () => {
    await expect(open()).rejects.toThrow("NEXT_REDIRECT /people/p1");
  });

  it("still shows the link form when the card is off", async () => {
    appSettingInt.mockResolvedValue(0);
    getPerson.mockResolvedValue({ id: "p1", name: "Sam", keepsList: false });
    const page = await open();
    expect(redirect).not.toHaveBeenCalled();
    expect(findListLink(page as ReactNode)).toMatchObject({ variant: "page", keepsList: false, heldGiftNotice: true });
  });

  // Money: where a held gift would ship is hidden only when there's surely none.
  it.each([
    ["hides where held gifts ship without access", { access: false, requested: false }, false],
    ["shows it when the check fails", null, true],
  ])("%s", async (_, access, heldGiftNotice) => {
    readAccess.mockResolvedValue(access);
    appSettingInt.mockResolvedValue(0);
    expect(findListLink((await open()) as ReactNode)).toMatchObject({ heldGiftNotice });
  });

  it("keeps a linked person on the old screen, with Unlink, when the card is off", async () => {
    appSettingInt.mockResolvedValue(0);
    getPersonShareToken.mockResolvedValue("tok");
    const page = await open();
    expect(redirect).not.toHaveBeenCalled();
    const props = findListLink(page as ReactNode);
    // keepsList plus an unlink action is what makes ListLink show Unlink.
    expect(props).toMatchObject({ variant: "page", keepsList: true });
    expect(props?.unlinkAction).toBeTypeOf("function");
  });

  it.each([2, -1])("treats a setting of %i as off", async (value) => {
    appSettingInt.mockResolvedValue(value);
    getPersonShareToken.mockResolvedValue("tok");
    await expect(open()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
