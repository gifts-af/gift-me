// @vitest-environment node
// Adding a gift from the extension (ALL-78), on a fake store: the form's shape,
// each add_item outcome, the photo's queue → upload → add order and its clean-up
// (AC-9c), and the one event per add with ids only (AC-22, E6). The database side
// of add_item is supabase/tests/extension_add.test.sql and add-item-db.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFromExtension, parseExtensionAddForm, type AddItemRow, type ExtensionAddInput, type ExtensionAddStore } from "../extension-add";
import { MAX_ITEMS } from "../save-list";

const ITEM = "33333333-3333-4333-8333-333333333333";
const LIST = "11111111-1111-4111-8111-111111111111";
const PUBLIC = `https://db.test/storage/v1/object/public/list-photos/${ITEM}.jpg`;
const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: "image/jpeg" });

function form(fields: Record<string, string | Blob> = {}, drop: string[] = []) {
  const f = new FormData();
  const base: Record<string, string | Blob> = {
    v: "1",
    name: "Yeti Mug",
    priceCents: "3500",
    pageUrl: "https://shop.test/mug?utm_source=x#top",
    ...fields,
  };
  for (const [k, v] of Object.entries(base)) if (!drop.includes(k)) f.set(k, v);
  return f;
}

function input(over: Partial<ExtensionAddInput> = {}): ExtensionAddInput {
  return {
    itemId: ITEM,
    name: "Yeti Mug",
    priceCents: 3500,
    link: "https://shop.test/mug",
    productId: null,
    confirmLikely: false,
    photo: null,
    photoMaxBytes: 100,
    ...over,
  };
}

function fakeStore(row: Partial<AddItemRow> | Error = { outcome: "added" }) {
  const calls: string[] = [];
  const store = {
    userId: "user-1",
    queuePhoto: vi.fn(async () => void calls.push("queue")),
    uploadPhoto: vi.fn(async () => {
      calls.push("upload");
      return PUBLIC;
    }),
    deletePhoto: vi.fn(async () => void calls.push("delete")),
    addItem: vi.fn(async () => {
      calls.push("add");
      if (row instanceof Error) throw row;
      return { outcome: "added", listId: LIST, itemId: row.outcome === "added" ? ITEM : null, existing: null, ...row };
    }),
  } satisfies ExtensionAddStore;
  return { store, calls };
}

let log: { mock: { calls: unknown[][] } };
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const events = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

describe("parseExtensionAddForm", () => {
  it("reads the current shape, saving the cleaned canonical link", () => {
    const photo = JPEG();
    const parsed = parseExtensionAddForm(
      form({ canonicalUrl: "https://shop.test/mug?fbclid=1", productId: " SKU-1 ", confirmLikely: "1", photo }),
    );
    expect(parsed).toEqual({
      ok: true,
      input: {
        name: "Yeti Mug",
        priceCents: 3500,
        link: "https://shop.test/mug",
        productId: "SKU-1",
        confirmLikely: true,
        photo: expect.any(Blob),
      },
    });
  });

  it("falls back to the cleaned page link with no canonical link", () => {
    const parsed = parseExtensionAddForm(form());
    expect(parsed.ok && parsed.input.link).toBe("https://shop.test/mug");
    expect(parsed.ok && parsed.input).toMatchObject({ productId: null, confirmLikely: false, photo: null });
  });

  it("keeps the page's variant on a Shopify-style canonical link, so two sizes are two links (B1)", () => {
    const size = (variant: string) =>
      parseExtensionAddForm(
        form({ pageUrl: `https://www.tee.test/products/tee?variant=${variant}&utm_source=x`, canonicalUrl: "https://tee.test/products/tee" }),
      );
    const small = size("111");
    const large = size("222");
    expect(small.ok && small.input.link).toBe("https://tee.test/products/tee?variant=111");
    expect(large.ok && large.input.link).toBe("https://tee.test/products/tee?variant=222");
  });

  it("uses a canonical link for another path as it is", () => {
    const parsed = parseExtensionAddForm(
      form({ pageUrl: "https://shop.test/sale/mug?variant=2", canonicalUrl: "https://shop.test/mug" }),
    );
    expect(parsed.ok && parsed.input.link).toBe("https://shop.test/mug");
  });

  it("ignores a canonical link that isn't a web link", () => {
    const parsed = parseExtensionAddForm(form({ canonicalUrl: "javascript:alert(1)" }));
    expect(parsed.ok && parsed.input.link).toBe("https://shop.test/mug");
  });

  it.each([["missing", undefined], ["0", "0"], ["2", "2"]])("asks for an update when v is %s (AC-21)", (_label, v) => {
    const parsed = parseExtensionAddForm(v === undefined ? form({}, ["v"]) : form({ v }));
    expect(parsed).toEqual({ ok: false, status: 400, error: "Update the GiftsAF extension." });
  });

  it.each([
    ["no name", form({ name: "  " })],
    ["a name over 300", form({ name: "x".repeat(301) })],
    ["a negative price", form({ priceCents: "-1" })],
    ["a fractional price", form({ priceCents: "1.5" })],
    ["a price over the cap", form({ priceCents: "100000001" })],
    ["no page link", form({}, ["pageUrl"])],
    ["a page link that isn't http(s)", form({ pageUrl: "data:text/html,hi" })],
    ["a photo that isn't a file", form({ photo: "abc" })],
  ])("refuses %s", (_label, f) => {
    expect(parseExtensionAddForm(f)).toEqual({ ok: false, status: 400, error: "That gift couldn't be read." });
  });

  it("drops a product id too long to store", () => {
    const parsed = parseExtensionAddForm(form({ productId: "x".repeat(129) }));
    expect(parsed.ok && parsed.input.productId).toBeNull();
  });
});

describe("addFromExtension", () => {
  it("adds a gift with no photo: 201 with the item id, nothing stored", async () => {
    const { store, calls } = fakeStore();
    const result = await addFromExtension(store, input());
    expect(result).toEqual({ status: 201, body: { outcome: "added", itemId: ITEM } });
    expect(calls).toEqual(["add"]);
    expect(store.addItem).toHaveBeenCalledWith({
      itemId: ITEM,
      name: "Yeti Mug",
      priceCents: 3500,
      productUrl: "https://shop.test/mug",
      productId: null,
      photoUrl: null,
      confirmLikely: false,
      maxItems: MAX_ITEMS,
    });
  });

  it("queues, then uploads, then adds with the photo's public URL, and keeps it", async () => {
    const { store, calls } = fakeStore();
    const result = await addFromExtension(store, input({ photo: JPEG(), confirmLikely: true, productId: "SKU-1" }));
    expect(result.status).toBe(201);
    expect(calls).toEqual(["queue", "upload", "add"]);
    expect(store.queuePhoto).toHaveBeenCalledWith(ITEM);
    expect(store.uploadPhoto).toHaveBeenCalledWith(ITEM, expect.any(Uint8Array));
    expect(store.addItem).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: PUBLIC, confirmLikely: true, productId: "SKU-1" }));
    expect(store.deletePhoto).not.toHaveBeenCalled();
  });

  it("200 duplicate, and deletes the uploaded photo straight away (AC-9c)", async () => {
    const { store, calls } = fakeStore({ outcome: "duplicate" });
    const result = await addFromExtension(store, input({ photo: JPEG() }));
    expect(result).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(calls).toEqual(["queue", "upload", "add", "delete"]);
    expect(store.deletePhoto).toHaveBeenCalledWith(ITEM);
  });

  it("200 likely, with the gift already on the list", async () => {
    const existing = { id: "x", name: "Yeti mug 20oz", price_cents: 3000, image_url: "https://img.test/a.jpg" };
    const { store, calls } = fakeStore({ outcome: "likely", existing });
    const result = await addFromExtension(store, input({ photo: JPEG() }));
    expect(result).toEqual({
      status: 200,
      body: { outcome: "likely", existing: { name: "Yeti mug 20oz", priceCents: 3000, imageUrl: "https://img.test/a.jpg" } },
    });
    expect(calls.at(-1)).toBe("delete");
  });

  it("200 full when the list is at its limit", async () => {
    const { store, calls } = fakeStore({ outcome: "full" });
    expect(await addFromExtension(store, input({ photo: JPEG() }))).toEqual({ status: 200, body: { outcome: "full" } });
    expect(calls.at(-1)).toBe("delete");
  });

  it("treats a unique violation from add_item as a duplicate", async () => {
    const { store } = fakeStore(Object.assign(new Error("add_item failed"), { code: "23505" }));
    expect(await addFromExtension(store, input({ photo: JPEG() }))).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(store.deletePhoto).toHaveBeenCalledWith(ITEM);
    expect(events()).toEqual([expect.objectContaining({ event: "list.extension_add", outcome: "duplicate" })]);
  });

  it.each([
    ["not a JPEG", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })],
    ["JPEG-typed but not JPEG bytes", new Blob(["<svg/>"], { type: "image/jpeg" })],
    ["empty", new Blob([], { type: "image/jpeg" })],
    ["over list_photo_max_bytes", new Blob([new Uint8Array([0xff, 0xd8, 0xff, ...new Array(98).fill(0)])], { type: "image/jpeg" })],
  ])("refuses a photo that is %s before anything is queued", async (_label, photo) => {
    const { store, calls } = fakeStore();
    expect(await addFromExtension(store, input({ photo }))).toEqual({ status: 400, body: { error: "That photo couldn't be used." } });
    expect(calls).toEqual([]);
  });

  it("deletes the photo and logs failed when add_item throws", async () => {
    const { store, calls } = fakeStore(Object.assign(new Error("boom: Yeti Mug https://shop.test/mug"), { code: "23514" }));
    const result = await addFromExtension(store, input({ photo: JPEG() }));
    expect(result).toEqual({ status: 500, body: { error: "Couldn't add that gift. Try again." } });
    expect(calls).toEqual(["queue", "upload", "add", "delete"]);
    expect(events()).toEqual([
      { event: "list.extension_add", at: expect.any(String), outcome: "failed", user_id: "user-1", item_id: ITEM, error: "Error", code: "23514" },
    ]);
  });

  it("deletes the photo and logs failed when the upload throws", async () => {
    const { store, calls } = fakeStore();
    store.uploadPhoto.mockRejectedValueOnce(new Error("storage down"));
    const result = await addFromExtension(store, input({ photo: JPEG() }));
    expect(result.status).toBe(500);
    expect(calls).toEqual(["queue", "delete"]);
    expect(store.addItem).not.toHaveBeenCalled();
    expect(events()[0]).toMatchObject({ outcome: "failed" });
  });

  it("uploads nothing when queueing fails", async () => {
    const { store } = fakeStore();
    store.queuePhoto.mockRejectedValueOnce(new Error("db down"));
    expect((await addFromExtension(store, input({ photo: JPEG() }))).status).toBe(500);
    expect(store.uploadPhoto).not.toHaveBeenCalled();
    expect(store.addItem).not.toHaveBeenCalled();
  });

  it("still answers when deleting a photo fails: the queue row lets the tick remove it", async () => {
    const { store } = fakeStore({ outcome: "duplicate" });
    store.deletePhoto.mockRejectedValueOnce(new Error("storage down"));
    expect(await addFromExtension(store, input({ photo: JPEG() }))).toEqual({ status: 200, body: { outcome: "duplicate" } });
  });

  it.each(["added", "duplicate", "likely", "full"])(
    "logs one %s event with ids only, never the name, link or price (AC-22)",
    async (outcome) => {
      const existing = outcome === "likely" ? { name: "Yeti", price_cents: 1, image_url: null } : null;
      const { store } = fakeStore({ outcome, existing });
      await addFromExtension(store, input({ photo: JPEG() }));
      const logged = events();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ event: "list.extension_add", outcome, user_id: "user-1", list_id: LIST });
      expect(Object.keys(logged[0]).sort()).toEqual(
        outcome === "added"
          ? ["at", "event", "item_id", "list_id", "outcome", "user_id"]
          : ["at", "event", "list_id", "outcome", "user_id"],
      );
      expect(JSON.stringify(logged[0])).not.toMatch(/Yeti|shop\.test|3500/);
    },
  );
});
