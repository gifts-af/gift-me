// POST /api/lists/items (ALL-78): CORS for the extension only, sign-in, the off
// switch (AC-20), the shape version (AC-21) and each outcome's status. The add's
// own logic is modules/lists/lib/__tests__/extension-add.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

// createStore(token) stands for the token check: a fake store when it is valid, null when not.
const createStore = vi.fn();
let settings: Record<string, number | Error> = {};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: async (token: string) => {
    const store = await createStore(token);
    return store ? { db: { store }, userId: "u1" } : null;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/app-settings", () => ({
  appSettingInt: async (key: string, db: unknown) => {
    if (!db) throw new Error("read as the bearer user, not by cookie");
    const v = settings[key];
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error("missing");
    return v;
  },
}));
vi.mock("@/modules/lists", async () => {
  const actual = await vi.importActual<typeof import("@/modules/lists/lib/extension-add")>(
    "@/modules/lists/lib/extension-add",
  );
  return {
    addFromExtension: actual.addFromExtension,
    parseExtensionAddForm: actual.parseExtensionAddForm,
    extensionAddStoreFor: (db: { store: unknown }, userId: string) => {
      expect(userId).toBe("u1");
      return db.store;
    },
  };
});

import { OPTIONS, POST } from "../route";

const ID = "abcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}`;
const URL_ = "https://app.test/api/lists/items";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function form(fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ v: "1", name: "Mug", priceCents: "1200", pageUrl: "https://shop.test/mug", ...fields })) {
    f.set(k, v);
  }
  return f;
}

const post = (headers: Record<string, string>, body: FormData = form()) =>
  new Request(URL_, { method: "POST", headers, body });
const signedIn = (body?: FormData) => post({ origin: ORIGIN, authorization: "Bearer t" }, body);

function fakeStore(outcome = "added") {
  return {
    userId: "u1",
    queuePhoto: vi.fn(),
    uploadPhoto: vi.fn(),
    deletePhoto: vi.fn(),
    addItem: vi.fn(async (args: { itemId: string }) => ({
      outcome,
      listId: "l1",
      itemId: outcome === "added" ? args.itemId : null,
      existing: outcome === "likely" ? { name: "Mug", price_cents: 1000, image_url: null } : null,
    })),
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", ID);
  createStore.mockReset();
  settings = { extension_add_enabled: 1, list_photo_max_bytes: 200000, list_max_items: 500 };
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("OPTIONS", () => {
  it("answers the extension's preflight", async () => {
    const res = await OPTIONS(new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });

  it("gives another origin no Allow-Origin", async () => {
    const res = await OPTIONS(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://evil.test" } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST", () => {
  it("gives another origin no Allow-Origin, even signed in", async () => {
    createStore.mockResolvedValue(fakeStore());
    const res = await POST(post({ origin: "https://evil.test", authorization: "Bearer t" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("401 without a bearer token (AC-18)", async () => {
    const res = await POST(post({ origin: ORIGIN }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in again." });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(createStore).not.toHaveBeenCalled();
  });

  it("401 when the token isn't valid (AC-18)", async () => {
    createStore.mockResolvedValue(null);
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer expired" }));
    expect(res.status).toBe(401);
    expect(createStore).toHaveBeenCalledWith("expired");
  });

  it.each([
    ["off", 0 as number | Error],
    ["unreadable", new Error("no setting") as number | Error],
  ])("503 when extension_add_enabled is %s, adding nothing (AC-20)", async (_label, value) => {
    settings.extension_add_enabled = value;
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const res = await POST(signedIn());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Adding from the extension is paused." });
    expect(store.addItem).not.toHaveBeenCalled();
    expect(store.queuePhoto).not.toHaveBeenCalled();
  });

  it("400 asking for an update when v isn't 1, adding nothing (AC-21)", async () => {
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const res = await POST(signedIn(form({ v: "0" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Update the GiftsAF extension." });
    expect(store.addItem).not.toHaveBeenCalled();
  });

  it("400 for a body that isn't a form", async () => {
    createStore.mockResolvedValue(fakeStore());
    const res = await POST(
      new Request(URL_, { method: "POST", headers: { origin: ORIGIN, authorization: "Bearer t", "content-type": "application/json" }, body: "{}" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Update the GiftsAF extension." });
  });

  it("201 with a fresh item id on each add", async () => {
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const first = await POST(signedIn());
    const second = await POST(signedIn());
    expect(first.status).toBe(201);
    expect(first.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const a = await first.json();
    const b = await second.json();
    expect(a).toEqual({ outcome: "added", itemId: expect.stringMatching(UUID) });
    expect(b.itemId).not.toBe(a.itemId);
  });

  it.each([
    ["duplicate", { outcome: "duplicate" }],
    ["likely", { outcome: "likely", existing: { name: "Mug", priceCents: 1000, imageUrl: null } }],
    ["full", { outcome: "full" }],
  ])("200 %s", async (outcome, body) => {
    createStore.mockResolvedValue(fakeStore(outcome));
    const res = await POST(signedIn());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("500, logged, when list_photo_max_bytes can't be read", async () => {
    settings.list_photo_max_bytes = new Error("no setting");
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const res = await POST(signedIn());
    expect(res.status).toBe(500);
    expect(store.addItem).not.toHaveBeenCalled();
    const log = vi.mocked(console.log).mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(log).toEqual([{ event: "list.extension_add", at: expect.any(String), outcome: "failed", error: "Error" }]);
  });

  it("adds with the item limit from list_max_items", async () => {
    settings.list_max_items = 12;
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    await POST(signedIn());
    expect(store.addItem).toHaveBeenCalledWith(expect.objectContaining({ maxItems: 12 }));
  });

  it("500 when list_max_items can't be read", async () => {
    settings.list_max_items = new Error("no setting");
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const res = await POST(signedIn());
    expect(res.status).toBe(500);
    expect(store.addItem).not.toHaveBeenCalled();
  });

  it("refuses an oversize photo with the limit from list_photo_max_bytes", async () => {
    settings.list_photo_max_bytes = 4;
    const store = fakeStore();
    createStore.mockResolvedValue(store);
    const body = form();
    body.set("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])], { type: "image/jpeg" }), "p.jpg");
    const res = await POST(signedIn(body));
    expect(res.status).toBe(400);
    expect(store.queuePhoto).not.toHaveBeenCalled();
  });

  it("500 when the extension id is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "");
    const error = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(signedIn());
    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("extension.origin_unset"));
  });
});
