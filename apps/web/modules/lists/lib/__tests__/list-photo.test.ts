// AC-6 (ALL-78): a gift added from the extension with a photo shows that photo
// on My list and the shared list. add_item stores the photo's public URL as the
// gift's image_url (supabase/tests/extension_add.test.sql); these check that
// both reads hand that URL to the gift card as imageUrl. Fake clients.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const sharedRpc = vi.fn();
const getClaims = vi.fn();
let listRead: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeDb(),
}));
const { getMyList, getSharedList } = await import("../lists");

const ITEM = "33333333-3333-4333-8333-333333333333";
const PHOTO = `https://db.test/storage/v1/object/public/list-photos/${ITEM}.jpg`;
const added = {
  id: ITEM,
  name: "Yeti Mug",
  price_cents: 3500,
  image_url: PHOTO,
  product_url: "https://shop.test/mug",
  asin: null,
  source: "extension",
  added_at: "2026-11-20T12:00:00+00:00",
};

function fakeDb() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    limit: () => query,
    maybeSingle: async () => listRead,
  };
  return {
    auth: { getClaims },
    schema: () => ({ from: () => query, rpc: sharedRpc }),
  } as unknown as SupabaseClient;
}

describe("an added gift's stored photo (AC-6)", () => {
  it("is the gift's imageUrl on My list", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } } });
    listRead = {
      data: { id: "l1", title: "My list", share_token: "tok", version: "v1", list_items: [added] },
      error: null,
    };
    const mine = await getMyList();
    expect(mine?.items).toEqual([expect.objectContaining({ id: ITEM, imageUrl: PHOTO, source: "extension" })]);
  });

  it("is the gift's imageUrl on the shared list", async () => {
    sharedRpc.mockResolvedValue({
      data: { title: "My list", is_owner: false, viewer: { signed_in: false }, items: [{ ...added, claim: null }] },
      error: null,
    });
    const shared = await getSharedList("44444444-4444-4444-8444-444444444444");
    expect(shared?.items).toEqual([expect.objectContaining({ id: ITEM, imageUrl: PHOTO })]);
  });
});
