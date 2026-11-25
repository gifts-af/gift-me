import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BirthdayHint } from "@/components/birthday-hint";
import type { MyBirthday } from "@/lib/account-birthday";

// Who gets the note under Share (ALL-182 AC-13). What it looks like and when it
// shows is in gift-app.test.tsx; the browser journey covers the real thing.
const t = vi.hoisted(() => ({ birthday: { kind: "none" } as unknown, on: true, list: {} as unknown }));
vi.mock("@/app/settings/address-actions", () => ({ saveMyAddressAction: vi.fn(), setSharingAction: vi.fn() }));
vi.mock("@/app/settings/actions", () => ({ saveDisplayName: vi.fn() }));
vi.mock("@/components/address/share-address-switch", () => ({ ShareAddressSwitch: () => null }));
vi.mock("@/components/app-shell/app-nav", () => ({ AppNav: () => null }));
vi.mock("@/components/app-shell/top-bar", () => ({ TopBar: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: vi.fn() }));
vi.mock("@/lib/account-address", () => ({ getSharing: async () => ({ kind: "none" }) }));
vi.mock("@/lib/account-birthday", () => ({ getMyBirthday: async () => t.birthday, birthdaySharingOn: async () => t.on }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { display_name: "Sam" }, error: null }) }) }),
  }),
}));
vi.mock("@/modules/lists", () => ({ GiftApp: () => null, GiftAppSkeleton: () => null, getMyList: async () => t.list }));

const { default: ListsPage } = await import("../page");

async function hint(): Promise<ReactNode> {
  const stack: ReactNode[] = [ListsPage()];
  while (stack.length > 0) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (isValidElement<{ children?: ReactNode }>(n)) {
      if (typeof n.type === "function" && n.type.name === "ListLoader") {
        const app = await (n.type as () => Promise<ReactElement<{ shareHint?: ReactNode }>>)();
        return app.props.shareHint ?? null;
      }
      stack.push(n.props.children);
    }
  }
  throw new Error("No ListLoader in the page");
}

describe("My list's note under Share", () => {
  beforeEach(() => {
    t.birthday = { kind: "none" };
    t.on = true;
    t.list = {};
  });

  it("is there with no birthday saved", async () => {
    const node = await hint();
    expect(isValidElement(node) && node.type).toBe(BirthdayHint);
  });

  it.each<MyBirthday>([{ kind: "saved", month: 3, day: 14 }, { kind: "unavailable" }])("isn't there when it's %j", async (b) => {
    t.birthday = b;
    expect(await hint()).toBeNull();
  });

  it("isn't there when the feature is off, or for a guest", async () => {
    t.on = false;
    expect(await hint()).toBeNull();
    t.on = true;
    t.list = null;
    expect(await hint()).toBeNull();
  });
});
