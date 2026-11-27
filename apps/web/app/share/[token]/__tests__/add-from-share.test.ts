import { beforeEach, describe, expect, it, vi } from "vitest";

// "+ My list" on a shared list: the action reads the gift through the shared
// list, refuses the owner and dead links, and goes through add_item's store
// (mocked here; extension-add.test.ts covers the add itself).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const getSharedList = vi.fn();
const addFromExtension = vi.fn();
const extensionAddStoreFor = vi.fn(() => ({ userId: "u1" }));
const readStoredPhoto = vi.fn();
const setGiftImageUrl = vi.fn();
const setCopiedFrom = vi.fn();
const { UUID_PATTERN } = await vi.importActual<typeof import("@/modules/lists/lib/lists")>("@/modules/lists/lib/lists");
const { storedPhotoId } = await vi.importActual<typeof import("@/modules/lists/lib/share-photo")>("@/modules/lists/lib/share-photo");
vi.mock("@/modules/lists", () => ({
  getSharedList,
  addFromExtension,
  extensionAddStoreFor,
  readStoredPhoto,
  setGiftImageUrl,
  setCopiedFrom,
  storedPhotoId,
  linkUnlinkedPerson: vi.fn(),
  unlinkPerson: vi.fn(),
  UUID_PATTERN,
}));

vi.mock("@/lib/log", () => ({ logEvent: vi.fn(), errorFields: vi.fn() }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: vi.fn(async (key: string) => (key === "list_max_items" ? 500 : 1048576)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));

const { addFromShareAction } = await import("../actions");

const TOKEN = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";

const gift = (over: Record<string, unknown> = {}) => ({
  id: ITEM,
  name: "Kettle",
  priceCents: 3200,
  imageUrl: null,
  productUrl: "https://shop.example/kettle?color=red",
  asin: null,
  source: "manual",
  addedAt: 0,
  claim: { name: "Someone", mine: false },
  ...over,
});
const shared = (over: Record<string, unknown> = {}) => ({
  title: "t",
  cardEnabled: true,
  ownerName: "Ann",
  linkedPerson: null,
  isOwner: false,
  viewer: { signedIn: true, name: "Sam" },
  items: [gift()],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSharedList.mockResolvedValue(shared());
  addFromExtension.mockResolvedValue({ status: 201, body: { outcome: "added", itemId: "new" } });
  readStoredPhoto.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
  setGiftImageUrl.mockResolvedValue(undefined);
  setCopiedFrom.mockResolvedValue(undefined);
});

describe("addFromShareAction", () => {
  it("refuses a bad token without reading anything", async () => {
    expect(await addFromShareAction("../../settings", ITEM)).toEqual({ ok: false, error: "Couldn't add that gift. Try again." });
    expect(getSharedList).not.toHaveBeenCalled();
  });

  it("refuses a reset or unshared link", async () => {
    getSharedList.mockResolvedValue(null);
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: false, error: "This list isn't shared any more." });
    expect(addFromExtension).not.toHaveBeenCalled();
  });

  it("refuses the list's owner", async () => {
    getSharedList.mockResolvedValue(shared({ isOwner: true }));
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: false, error: "This is already your list." });
    expect(addFromExtension).not.toHaveBeenCalled();
  });

  it("refuses a gift that isn't on the shared list", async () => {
    getSharedList.mockResolvedValue(shared({ items: [] }));
    expect((await addFromShareAction(TOKEN, ITEM)).ok).toBe(false);
    expect(addFromExtension).not.toHaveBeenCalled();
  });

  it("copies the gift, its link and its stored photo, and logs lists.added_from_share", async () => {
    const photoUrl = `https://x.supabase.co/storage/v1/object/public/list-photos/${PHOTO}.jpg`;
    getSharedList.mockResolvedValue(shared({ items: [gift({ imageUrl: photoUrl })] }));
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: true });
    expect(readStoredPhoto).toHaveBeenCalledWith(expect.anything(), PHOTO);
    const input = addFromExtension.mock.calls[0][1];
    expect(input).toMatchObject({
      name: "Kettle",
      priceCents: 3200,
      link: "https://shop.example/kettle?color=red",
      maxItems: 500,
      event: "lists.added_from_share",
    });
    expect(input.itemId).not.toBe(ITEM);
    expect(input.photo).toBeInstanceOf(Blob);
    // Never the claim.
    expect(JSON.stringify(input)).not.toContain("Someone");
    expect(setGiftImageUrl).not.toHaveBeenCalled();
  });

  it("keeps a store's own photo link on the new gift", async () => {
    getSharedList.mockResolvedValue(shared({ items: [gift({ imageUrl: "https://cdn.shop.example/k.jpg" })] }));
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: true });
    expect(addFromExtension.mock.calls[0][1].photo).toBeNull();
    expect(setGiftImageUrl).toHaveBeenCalledWith(expect.anything(), addFromExtension.mock.calls[0][1].itemId, "https://cdn.shop.example/k.jpg");
  });

  it("records which gift the copy came from, for the creator's credit", async () => {
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: true });
    expect(setCopiedFrom).toHaveBeenCalledWith(expect.anything(), addFromExtension.mock.calls[0][1].itemId, ITEM);
  });

  it("still adds the gift when recording its source fails", async () => {
    setCopiedFrom.mockRejectedValue(new Error("no"));
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: true });
  });

  it("counts a gift already on your list as done, and records no source", async () => {
    addFromExtension.mockResolvedValue({ status: 200, body: { outcome: "duplicate" } });
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: true });
    expect(setCopiedFrom).not.toHaveBeenCalled();
  });

  it("says when your list is full", async () => {
    addFromExtension.mockResolvedValue({ status: 200, body: { outcome: "full" } });
    expect(await addFromShareAction(TOKEN, ITEM)).toEqual({ ok: false, error: "Your list is full. Remove a gift to add this one." });
  });
});
