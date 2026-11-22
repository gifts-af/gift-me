// Which client does what in the extension add (ALL-78): the photo queue and
// storage go through the service role (users can't write list-photos), and
// add_item runs as the user so RLS applies. Fake clients; the SQL itself is
// covered by supabase/tests/extension_add.test.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { extensionAddStoreFor } from "../extension-add-store";

const ITEM = "33333333-3333-4333-8333-333333333333";
const PUBLIC = `https://db.test/storage/v1/object/public/list-photos/${ITEM}.jpg`;

function clients(addResult: { data: unknown; error: unknown } = { data: [], error: null }) {
  const userRpc = vi.fn().mockResolvedValue(addResult);
  const adminRpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://db.test/storage/v1/object/public/list-photos/${path}` } }));
  const bucket = vi.fn(() => ({ upload, remove, getPublicUrl }));
  const user = { schema: vi.fn(() => ({ rpc: userRpc })) } as unknown as SupabaseClient;
  const admin = { schema: vi.fn(() => ({ rpc: adminRpc })), storage: { from: bucket } } as unknown as SupabaseClient;
  const makeAdmin = vi.fn(() => admin);
  return { user, admin, makeAdmin, userRpc, adminRpc, upload, remove, bucket };
}

describe("extensionAddStoreFor", () => {
  it("queues the photo with the service role", async () => {
    const c = clients();
    await extensionAddStoreFor(c.user, "u1", c.makeAdmin).queuePhoto(ITEM);
    expect(c.admin.schema).toHaveBeenCalledWith("lists");
    expect(c.adminRpc).toHaveBeenCalledWith("queue_photo", { p_item_id: ITEM });
  });

  it("uploads {id}.jpg as a JPEG, never overwriting, and returns its public URL", async () => {
    const c = clients();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const url = await extensionAddStoreFor(c.user, "u1", c.makeAdmin).uploadPhoto(ITEM, bytes);
    expect(c.bucket).toHaveBeenCalledWith("list-photos");
    expect(c.upload).toHaveBeenCalledWith(`${ITEM}.jpg`, bytes, { contentType: "image/jpeg", upsert: false });
    expect(url).toBe(PUBLIC);
  });

  it("throws when the upload fails", async () => {
    const c = clients();
    c.upload.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    await expect(extensionAddStoreFor(c.user, "u1", c.makeAdmin).uploadPhoto(ITEM, new Uint8Array(3))).rejects.toThrow();
  });

  it("deletes {id}.jpg with the service role", async () => {
    const c = clients();
    await extensionAddStoreFor(c.user, "u1", c.makeAdmin).deletePhoto(ITEM);
    expect(c.remove).toHaveBeenCalledWith([`${ITEM}.jpg`]);
  });

  it("runs add_item as the user and reads its row", async () => {
    const c = clients({ data: [{ outcome: "added", list_id: "l1", item_id: ITEM, existing: null }], error: null });
    const store = extensionAddStoreFor(c.user, "u1", c.makeAdmin);
    const row = await store.addItem({
      itemId: ITEM,
      name: "Mug",
      priceCents: 100,
      productUrl: "https://shop.test/mug",
      productId: null,
      photoUrl: PUBLIC,
      confirmLikely: false,
      maxItems: 500,
    });
    expect(c.user.schema).toHaveBeenCalledWith("lists");
    expect(c.userRpc).toHaveBeenCalledWith("add_item", {
      p_item_id: ITEM,
      p_name: "Mug",
      p_price_cents: 100,
      p_product_url: "https://shop.test/mug",
      p_product_id: null,
      p_photo_url: PUBLIC,
      p_confirm_likely: false,
      p_max_items: 500,
    });
    expect(row).toEqual({ outcome: "added", listId: "l1", itemId: ITEM, existing: null });
    // An add on its own never makes a service-role client.
    expect(c.makeAdmin).not.toHaveBeenCalled();
  });

  it("throws add_item's error with its Postgres code", async () => {
    const c = clients({ data: null, error: { code: "23505", message: "duplicate key" } });
    const add = extensionAddStoreFor(c.user, "u1", c.makeAdmin).addItem({
      itemId: ITEM,
      name: "Mug",
      priceCents: 100,
      productUrl: "https://shop.test/mug",
      productId: null,
      photoUrl: null,
      confirmLikely: false,
      maxItems: 500,
    });
    await expect(add).rejects.toMatchObject({ code: "23505" });
  });
});
