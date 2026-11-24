import { beforeEach, describe, expect, it, vi } from "vitest";

// saveReactionAction's boundary: malformed input and a missing session never reach the save, and
// the pages that show the answer are refreshed. reactions-db.test.ts runs the real save.
const { createClient, saveReaction, revalidatePath, roundDbDeps } = vi.hoisted(() => ({
  createClient: vi.fn(),
  saveReaction: vi.fn(),
  revalidatePath: vi.fn(),
  roundDbDeps: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/wiring", () => ({ roundDbDeps }));
vi.mock("@/modules/concierge", () => ({ saveReaction, MAX_BUDGET_CENTS: 1 }));

import { saveReactionAction } from "../actions";

const ORDER = "00000000-0000-4000-8000-000000000001";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const signIn = (sub: string | undefined) => createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub } } }) } });

beforeEach(() => {
  vi.clearAllMocks();
  signIn("u1");
});

describe("saveReactionAction", () => {
  it.each([
    ["a bad id", "nope", { rating: "loved" }],
    ["no rating", ORDER, {}],
    ["a bad rating", ORDER, { rating: "adored" }],
    ["a note over the input bound", ORDER, { rating: "loved", note: "x".repeat(2001) }],
  ])("refuses %s before reading the session (AC-10)", async (_what, order, fields) => {
    expect(await saveReactionAction(order, form(fields as Record<string, string>))).toMatchObject({ ok: false, reason: "bad_form" });
    expect(createClient).not.toHaveBeenCalled();
    expect(saveReaction).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    signIn(undefined);
    expect(await saveReactionAction(ORDER, form({ rating: "loved" }))).toMatchObject({ ok: false, reason: "session" });
    expect(saveReaction).not.toHaveBeenCalled();
  });

  it("saves as the signed-in user and refreshes the pages that show it", async () => {
    saveReaction.mockResolvedValue({ ok: true, roundId: "r1", personId: "p1", complete: true });
    expect(await saveReactionAction(ORDER, form({ rating: "meh", note: "", userId: "u2" }))).toEqual({ ok: true, complete: true });
    expect(saveReaction.mock.calls[0][0]).toEqual({ userId: "u1", orderId: ORDER, rating: "meh", note: null });
    expect(revalidatePath.mock.calls.flat()).toEqual(["/rounds/r1", "/rounds/r1/reaction", "/people/p1", "/people/p1/gifts"]);
  });

  it("hands back a refusal and refreshes nothing", async () => {
    const refusal = { ok: false, reason: "off", error: "Not available right now." };
    saveReaction.mockResolvedValue(refusal);
    expect(await saveReactionAction(ORDER, form({ rating: "meh" }))).toEqual(refusal);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
