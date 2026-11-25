import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding someone from a shared list says where a held gift would ship.
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/app-shell/app-nav", () => ({ AppNav: () => null }));
const readAccess = vi.hoisted(() => vi.fn());
vi.mock("@/components/concierge-gate", () => ({ readAccess }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 512 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
const shared = vi.hoisted(() => ({ isOwner: false, ownerName: "Sam" }));
const getOwnerBirthday = vi.hoisted(() => vi.fn<(token: string) => Promise<{ month: number; day: number } | null>>());
vi.mock("@/modules/lists", () => ({ getSharedList: async () => shared, getOwnerBirthday }));
vi.mock("../actions", () => ({ addPersonAction: vi.fn(), setPhotoAction: vi.fn() }));

const { default: NewPersonPage } = await import("../new/page");

/** The page's async form, rendered: a component test can't await it in place. */
async function show(list?: string) {
  const stack: ReactNode[] = [NewPersonPage({ searchParams: Promise.resolve({ list }) })];
  while (stack.length > 0) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (isValidElement<{ children?: ReactNode }>(n)) {
      if (typeof n.type === "function" && n.type.name === "Form") {
        render(await (n.type as (props: unknown) => Promise<ReactElement>)(n.props));
        return;
      }
      stack.push(n.props.children);
    }
  }
  throw new Error("No Form in the page");
}

const notice = () => screen.queryByText("If a gift for them is waiting on an address, it will ship to this list's owner.");

describe("adding someone from a shared list", () => {
  beforeEach(() => {
    readAccess.mockReset();
    shared.isOwner = false;
    getOwnerBirthday.mockReset().mockResolvedValue(null);
  });

  it("starts with their birthday when they saved one (ALL-182 AC-5)", async () => {
    getOwnerBirthday.mockResolvedValue({ month: 3, day: 14 });
    await show("a-token");
    expect(getOwnerBirthday).toHaveBeenCalledWith("a-token");
    expect(screen.getByLabelText("Birthday month")).toHaveValue("3");
    expect(screen.getByLabelText("Birthday day")).toHaveValue(14);
  });

  it("starts empty with none, and for your own list (ALL-182 AC-6)", async () => {
    await show("a-token");
    expect(screen.getByLabelText("Birthday month")).toHaveValue("");
  });

  it("never asks for your own (ALL-182 AC-6)", async () => {
    shared.isOwner = true;
    await show("a-token");
    expect(getOwnerBirthday).not.toHaveBeenCalled();
  });

  it.each([
    ["shows where held gifts ship, with access", { access: true, requested: false }, true],
    ["hides it without access", { access: false, requested: false }, false],
    ["shows it when the access check fails", null, true],
  ])("%s", async (_, access, shown) => {
    readAccess.mockResolvedValue(access);
    await show("a-token");
    expect(screen.getByLabelText("Name")).toHaveValue("Sam");
    expect(notice() !== null).toBe(shown);
  });

  it("says nothing of it, and checks nothing, without a list", async () => {
    await show();
    expect(notice()).toBeNull();
    expect(readAccess).not.toHaveBeenCalled();
  });
});
