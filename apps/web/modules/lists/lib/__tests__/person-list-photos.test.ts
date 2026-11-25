import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ schema: () => ({ rpc }) }) }));
vi.mock("@/lib/log", () => ({ logEvent, errorFields: () => ({}) }));

import { getPersonListPhotos } from "../lists";

const PERSON = "11111111-1111-4111-8111-111111111111";
const items = (...urls: (string | null)[]) => ({ data: { title: "t", items: urls.map((image_url, i) => ({ id: `g${i}`, name: `Gift ${i}`, image_url, claimed: false })) }, error: null });

describe("getPersonListPhotos", () => {
  beforeEach(() => {
    rpc.mockReset();
    logEvent.mockReset();
  });

  it("gives the first three photos in list order, skipping gifts without one", async () => {
    rpc.mockResolvedValue(items(null, "https://x.test/1", "", "https://x.test/2", "https://x.test/3", "https://x.test/4"));
    expect(await getPersonListPhotos(PERSON)).toEqual([
      { giftId: "g1", name: "Gift 1", url: "https://x.test/1" },
      { giftId: "g3", name: "Gift 3", url: "https://x.test/2" },
      { giftId: "g4", name: "Gift 4", url: "https://x.test/3" },
    ]);
    expect(rpc).toHaveBeenCalledWith("person_list", { p_person_id: PERSON });
  });

  it("leaves out claimed gifts, whoever claimed them", async () => {
    const gift = (id: string, claimed: boolean, claimed_by_me = false) => ({ id, name: id, image_url: `https://x.test/${id}`, claimed, claimed_by_me });
    rpc.mockResolvedValue({
      data: { title: "t", items: [gift("a", true), gift("b", false), gift("c", true, true), gift("d", false), gift("e", false)] },
      error: null,
    });
    expect((await getPersonListPhotos(PERSON)).map((photo) => photo.giftId)).toEqual(["b", "d", "e"]);
  });

  it("shows a photo two gifts share only once", async () => {
    rpc.mockResolvedValue(items("https://x.test/1", "https://x.test/1"));
    expect(await getPersonListPhotos(PERSON)).toEqual([{ giftId: "g0", name: "Gift 0", url: "https://x.test/1" }]);
  });

  it("gives none for an empty list, or no linked list", async () => {
    rpc.mockResolvedValueOnce(items()).mockResolvedValueOnce({ data: null, error: null });
    expect(await getPersonListPhotos(PERSON)).toEqual([]);
    expect(await getPersonListPhotos(PERSON)).toEqual([]);
  });

  it("gives none when the read fails, and logs ids only", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "secret" } });
    expect(await getPersonListPhotos(PERSON)).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith("person_list_photos_failed", { person_id: PERSON, code: "42501" });
  });

  it("gives none for a malformed id without asking the database", async () => {
    expect(await getPersonListPhotos("nope")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
