import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// A person's routes (ALL-127): the 300 s limits, and the old address email
// link landing on the address screen.

vi.mock("server-only", () => ({}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../person-view", () => ({ PersonView: () => null }));
vi.mock("../person-gifts", () => ({ PersonGifts: () => null }));
vi.mock("../../actions", () => ({}));
vi.mock("@/modules/concierge", () => ({}));
vi.mock("@/modules/lists", () => ({}));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 1 }));

const personPage = await import("../page");
const addressPage = await import("../address/page");
const ideasPage = await import("../ideas/page");

/** The page's streamed part: the async component inside its Suspense. */
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

async function openPerson(search: Record<string, string>) {
  const page = personPage.default({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve(search) });
  const el = loaded(page);
  return (el.type as (props: unknown) => Promise<unknown>)(el.props);
}

describe("a person's routes", () => {
  // The address screen can place held gifts; the person's page reads captures
  // with AI (readCapturesAction), which can run long too (review of PR 1).
  it("keeps 300 s on the address screen and the person's page", () => {
    expect(addressPage.maxDuration).toBe(300);
    expect((personPage as { maxDuration?: number }).maxDuration).toBe(300);
  });

  // ALL-27: an idea run can take two AI and two Zinc timeouts (150 s as shipped).
  it("keeps 300 s on the Gift ideas screen", () => {
    expect(ideasPage.maxDuration).toBe(300);
  });

  it("sends the old address email link to the address screen, open (AC-19)", async () => {
    await expect(openPerson({ address: "open" })).rejects.toThrow("NEXT_REDIRECT /people/p1/address?open=1");
  });

  it("shows the person's page otherwise", async () => {
    redirect.mockClear();
    await openPerson({ photo: "failed" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
