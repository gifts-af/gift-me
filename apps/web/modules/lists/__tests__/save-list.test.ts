// @vitest-environment node
// Saving My list against the real local database (E5, ALL-127): each save
// carries the list's version, a stale one is refused with the latest list, and
// the close route's remove drops only the ids it names. Skipped when the local
// stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";

let current: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));

const { saveList } = await import("../actions/lists");
const { getMyList } = await import("../lib/lists");
const { removeGifts } = await import("../lib/save-list");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

const gift = (name: string, id: string = randomUUID()) => ({
  id,
  name,
  priceCents: 1200,
  imageUrl: null,
  productUrl: null,
  asin: null,
  source: "manual",
  addedAt: 0,
});

describe.skipIf(!dbUp)("saving My list with its version", () => {
  const s = stack?.supabase;
  const admin = s
    ? createClient(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const users: string[] = [];

  async function signedInClient(): Promise<{ db: SupabaseClient; id: string }> {
    const email = `save-list-${randomUUID()}@example.test`;
    const password = "local-only-password";
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { db, id: data.user.id };
  }

  let log: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });

  const events = (): ({ event?: string } | null)[] =>
    log.mock.calls.map(([line]) => {
      try {
        return JSON.parse(String(line));
      } catch {
        return null;
      }
    });

  it("round-trips the version as a string, and saves with it", async () => {
    const me = await signedInClient();
    current = me.db;
    const first = await saveList({ listId: null, version: null, items: [gift("Kettle")] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(typeof first.version).toBe("string");

    const loaded = await getMyList();
    expect(loaded?.list?.version).toBe(first.version);
    expect(loaded?.items.map((g) => g.name)).toEqual(["Kettle"]);

    const second = await saveList({
      listId: first.listId,
      version: loaded!.list!.version,
      items: [...loaded!.items, gift("Novel")],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.version).not.toBe(first.version);
    expect(second.items.map((g) => g.name)).toEqual(["Kettle", "Novel"]);
    expect((await getMyList())?.list?.version).toBe(second.version);
  });

  it("refuses a stale save with the latest gifts and version, and logs it by id", async () => {
    const me = await signedInClient();
    current = me.db;
    const first = await saveList({ listId: null, version: null, items: [gift("Kettle")] });
    if (!first.ok) throw new Error("first save failed");
    const tabA = await saveList({ listId: first.listId, version: first.version, items: [...first.items, gift("Scarf")] });
    if (!tabA.ok) throw new Error("tab A's save failed");

    // Tab B still holds the first version.
    const tabB = await saveList({ listId: first.listId, version: first.version, items: [...first.items, gift("Mug")] });
    expect(tabB).toEqual({
      ok: false,
      stale: true,
      listId: first.listId,
      shareToken: expect.any(String),
      version: tabA.version,
      items: tabA.items,
    });
    const stale = events().find((e) => e?.event === "list_save_stale");
    expect(stale).toEqual({ event: "list_save_stale", at: expect.any(String), list_id: first.listId, user_id: me.id });
    expect((await getMyList())?.items.map((g) => g.name)).toEqual(["Kettle", "Scarf"]);
  });

  it("refuses a second list from a tab that opened before the first existed", async () => {
    const me = await signedInClient();
    current = me.db;
    const first = await saveList({ listId: null, version: null, items: [gift("Kettle")] });
    if (!first.ok) throw new Error("first save failed");
    const again = await saveList({ listId: null, version: null, items: [gift("Mug")] });
    expect(again).toMatchObject({ ok: false, stale: true, listId: first.listId, version: first.version });
  });

  it("removes only the named gifts on close, even from an older version", async () => {
    const me = await signedInClient();
    current = me.db;
    const first = await saveList({ listId: null, version: null, items: [gift("Kettle"), gift("Novel"), gift("Mug")] });
    if (!first.ok) throw new Error("first save failed");
    // Another tab adds a gift after this one last saved.
    const other = await saveList({ listId: first.listId, version: first.version, items: [...first.items, gift("Scarf")] });
    if (!other.ok) throw new Error("other save failed");

    const novel = first.items.find((g) => g.name === "Novel")!.id;
    const result = await removeGifts(me.db, me.id, { listId: first.listId, version: first.version, removeIds: [novel] });
    expect(result).toEqual({ outcome: "saved", behind: true });
    expect((await getMyList())?.items.map((g) => g.name)).toEqual(["Kettle", "Mug", "Scarf"]);
  });

  it("says not found for someone else's list", async () => {
    const owner = await signedInClient();
    current = owner.db;
    const first = await saveList({ listId: null, version: null, items: [gift("Kettle")] });
    if (!first.ok) throw new Error("first save failed");
    const stranger = await signedInClient();
    const result = await removeGifts(stranger.db, stranger.id, {
      listId: first.listId,
      version: first.version,
      removeIds: [first.items[0].id],
    });
    expect(result.outcome).toBe("not_found");
  });
});
