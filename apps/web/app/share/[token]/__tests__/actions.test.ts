// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ALL-123 PR review: the share card's actions check both ids before doing any
// work, so a forged call can't make the server revalidate an arbitrary path (E4).
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
const linkUnlinkedPerson = vi.fn();
const unlinkPerson = vi.fn();
vi.mock("server-only", () => ({}));
const { UUID_PATTERN } = await vi.importActual<typeof import("@/modules/lists/lib/lists")>("@/modules/lists/lib/lists");
vi.mock("@/modules/lists", () => ({ linkUnlinkedPerson, unlinkPerson, UUID_PATTERN }));
vi.mock("@/lib/log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));

const { linkFromShareAction, unlinkFromShareAction } = await import("../actions");

const TOKEN = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const BAD = "../../settings";

beforeEach(() => {
  vi.clearAllMocks();
  linkUnlinkedPerson.mockResolvedValue({ ok: true, listId: "l1" });
  unlinkPerson.mockResolvedValue({ ok: true });
});

describe.each([
  ["link", linkFromShareAction, linkUnlinkedPerson],
  ["unlink", unlinkFromShareAction, unlinkPerson],
] as const)("%s from the share card", (_name, action, work) => {
  it.each([
    ["a bad token", BAD, PERSON],
    ["a bad person id", TOKEN, BAD],
  ])("refuses %s without doing anything", async (_case, token, personId) => {
    expect(await action(token, personId)).toEqual({ ok: false, error: "That didn't save. Try again." });
    expect(work).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("works and revalidates both pages for valid ids", async () => {
    expect(await action(TOKEN, PERSON)).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/share/${TOKEN}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON}`);
  });
});
