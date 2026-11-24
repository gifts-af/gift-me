import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// What the page shows in each state. The save and the reads run on the real database in
// reactions-db.test.ts.
const { roundAccess, reactionView, saveReactionAction } = vi.hoisted(() => ({
  roundAccess: vi.fn(),
  reactionView: vi.fn(),
  saveReactionAction: vi.fn(),
}));
vi.mock("@/modules/concierge", () => ({ roundAccess, reactionView }));
vi.mock("@/lib/wiring", () => ({ roundDbDeps: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("../actions", () => ({ saveReactionAction }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
Element.prototype.scrollIntoView = () => {};

const { default: ReactionPage } = await import("../[id]/reaction/page");

const gift = (orderId: string, title: string) => ({ orderId, title, imageUrl: null, rating: null, note: null });
const VIEW = {
  round: { id: "r1", personId: "p1", personName: "Nora", occasionKind: "birthday", occasionDate: "2026-12-18", status: "delivered" },
  gifts: [gift("o1", "Cozy blanket"), gift("o2", "Tea sampler")],
  closed: null,
  noteMaxChars: 500,
};

/** The page's streamed part: the async component inside its Suspense. */
function loaded(node: ReactNode): ReactElement {
  const stack: ReactNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (isValidElement<{ children?: ReactNode }>(n)) {
      if (typeof n.type === "function" && n.type.name === "Loaded") return n;
      stack.push(n.props.children);
    }
  }
  throw new Error("No Loaded component in the page");
}
async function show(search: Record<string, string | string[]> = {}) {
  const el = loaded(ReactionPage({ params: Promise.resolve({ id: "r1" }), searchParams: Promise.resolve(search) }));
  render(await (el.type as (p: unknown) => Promise<ReactElement>)(el.props));
}
const title = () => screen.getByRole("heading", { level: 1 }).textContent;

beforeEach(() => {
  vi.clearAllMocks();
  roundAccess.mockResolvedValue("mine");
  reactionView.mockResolvedValue(VIEW);
});

describe("the reaction page", () => {
  it("asks about two gifts", async () => {
    await show();
    expect(title()).toBe("How did Nora like them?");
    expect(screen.getByText("Birthday Fri, Dec 18")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("asks about one gift as one", async () => {
    reactionView.mockResolvedValue({ ...VIEW, gifts: VIEW.gifts.slice(0, 1) });
    await show();
    expect(title()).toBe("How did Nora like it?");
  });

  it("names nobody when the person was removed", async () => {
    reactionView.mockResolvedValue({ ...VIEW, round: { ...VIEW.round, personName: null } });
    await show();
    expect(title()).toBe("How did it go?");
  });

  it("a link's answer is chosen on its gift, and nothing is saved", async () => {
    await show({ gift: "o2", r: "returned" });
    expect(screen.getAllByRole("radio", { checked: true }).map((r) => r.closest("li")?.textContent)).toEqual([expect.stringContaining("Tea sampler")]);
    expect(saveReactionAction).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, string | string[]>]>([
    ["an unknown gift", { gift: "o9", r: "loved" }],
    ["an unknown answer", { gift: "o1", r: "toString" }],
    ["an answer for no gift", { r: "loved" }],
    ["repeated parts", { gift: ["o1", "o2"], r: ["loved", "meh"] }],
  ])("ignores %s", async (_, search) => {
    await show(search);
    expect(screen.queryAllByRole("radio", { checked: true })).toEqual([]);
  });

  it.each([
    ["off", { closed: "off" }, "Not available right now."],
    ["before the occasion", { closed: "too_early" }, "You can say how it went from Fri, Dec 18."],
    ["nothing delivered", { gifts: [] }, "No gift has arrived for this occasion."],
  ])("%s: says so, with nothing to answer", async (_, o, text) => {
    reactionView.mockResolvedValue({ ...VIEW, ...o });
    await show();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("another account learns nothing", async () => {
    roundAccess.mockResolvedValue("other");
    await show();
    expect(title()).toBe("This gift belongs to another account");
    expect(reactionView).not.toHaveBeenCalled();
  });

  it("is a 404 when the round is missing or hidden", async () => {
    roundAccess.mockResolvedValue("missing");
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    roundAccess.mockResolvedValue("mine");
    reactionView.mockResolvedValue(null);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
