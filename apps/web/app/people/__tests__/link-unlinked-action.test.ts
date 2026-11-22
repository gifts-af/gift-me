import { beforeEach, describe, expect, it, vi } from "vitest";

const linkUnlinkedPerson = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/log", () => ({ logEvent, errorFields: () => ({}) }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 1 }));
vi.mock("@/lib/wiring", () => ({ placeAddressHeld: async () => {}, onDemandIdeaDeps: async () => null }));
vi.mock("../notes-tip", () => ({ scheduleNotesTip: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("@/modules/lists", () => ({ linkUnlinkedPerson, cleanGiftLink: vi.fn(), readGiftLinkForUser: vi.fn() }));
vi.mock("@/modules/concierge", async () => {
  const rules = await vi.importActual<typeof import("@/modules/concierge/people/rules")>("@/modules/concierge/people/rules");
  return { parseShareToken: rules.parseShareToken };
});

import { linkUnlinkedListAction } from "../actions";

const TOKEN = "11111111-2222-3333-4444-555555555555";
const form = (id: string, link: string) => {
  const f = new FormData();
  f.set("id", id);
  f.set("link", link);
  return f;
};

describe("linkUnlinkedListAction (ALL-123)", () => {
  beforeEach(() => {
    linkUnlinkedPerson.mockReset();
    revalidatePath.mockClear();
    logEvent.mockClear();
  });

  it("links through linkUnlinkedPerson with the token from the pasted link, logs ids only, and refreshes", async () => {
    linkUnlinkedPerson.mockResolvedValue({ ok: true, listId: "l1" });
    const result = await linkUnlinkedListAction(null, form("p1", `https://giftsaf.com/share/${TOKEN}`));
    expect(result).toEqual({ ok: true });
    expect(linkUnlinkedPerson).toHaveBeenCalledWith(TOKEN, "p1");
    expect(logEvent).toHaveBeenCalledWith("lists.linked_from_share", { user_id: "u1", person_id: "p1", list_id: "l1" });
    expect(revalidatePath).toHaveBeenCalledWith("/people/p1");
  });

  it("asks for a share link when the paste isn't one, without calling the lists module", async () => {
    const result = await linkUnlinkedListAction(null, form("p1", "nope"));
    expect(result).toEqual({ ok: false, error: "Paste the share link from their GiftsAF list." });
    expect(linkUnlinkedPerson).not.toHaveBeenCalled();
  });

  it("passes the lists module's error through and logs nothing", async () => {
    linkUnlinkedPerson.mockResolvedValue({ ok: false, error: "Dad already has a list linked." });
    const result = await linkUnlinkedListAction(null, form("p1", TOKEN));
    expect(result).toEqual({ ok: false, error: "Dad already has a list linked." });
    expect(logEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
