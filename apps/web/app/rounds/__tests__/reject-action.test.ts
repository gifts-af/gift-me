import { beforeEach, describe, expect, it, vi } from "vitest";

// rejectAction's own checks on the form. What rejecting does is approval-db.test.ts, on the real database.
const rejectRoundIdeas = vi.fn(async (...a: unknown[]) => (void a, { ok: true, more: true, saved: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }) }));
vi.mock("@/lib/wiring", () => ({ roundDbDeps: () => ({}), buyDeps: () => ({}) }));
vi.mock("@/modules/concierge", () => ({ rejectRoundIdeas }));

const { rejectAction } = await import("../actions");
const ROUND = "00000000-0000-4000-8000-000000000001";
const IDEA = "00000000-0000-4000-8000-000000000002";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ text: "", expectMore: "1", ...o })) f.set(k, v);
  return f;
};

beforeEach(() => rejectRoundIdeas.mockClear());

describe("rejectAction", () => {
  it("Already has one with no gift named is refused, and nothing is rejected", async () => {
    expect(await rejectAction(ROUND, form({ code: "has_it" }))).toEqual({ ok: false, error: "bad_form" });
    expect(rejectRoundIdeas).not.toHaveBeenCalled();
  });

  it("with the gift named, or another reason, it goes through", async () => {
    expect(await rejectAction(ROUND, form({ code: "has_it", owned: IDEA }))).toMatchObject({ ok: true });
    expect(await rejectAction(ROUND, form({ code: "not_style" }))).toMatchObject({ ok: true });
  });
});
