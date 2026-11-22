// saveChecked's own shape, on a fake client: what comes back after a save and
// what's logged on a failure (E6: ids and the error code only). The real
// database behaviour is modules/lists/__tests__/save-list.test.ts and
// supabase/tests/lists.test.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readList } from "../lists";
import { saveChecked, toRow } from "../save-list";

const LIST = "11111111-1111-4111-8111-111111111111";
const row = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Kettle",
  price_cents: 1200,
  image_url: null,
  product_url: null,
  asin: null,
  source: "manual",
  added_at: "2026-11-16T12:00:00.123456+00:00",
};

function fakeDb(rpc: { data: unknown; error: unknown }, read = { data: null as unknown, error: null as unknown }) {
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      order: () => query,
      eq: () => query,
      limit: () => query,
      maybeSingle: async () => read,
    };
    return query;
  });
  const db = { schema: () => ({ rpc: async () => rpc, from }) } as unknown as SupabaseClient;
  return { db, from };
}

let log: { mock: { calls: unknown[][] } };
let error: { mock: { calls: unknown[][] } };
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const lastEvent = () => JSON.parse(String(log.mock.calls.at(-1)?.[0]));

describe("saveChecked", () => {
  it("returns the gifts the save wrote with its version, with no second read", async () => {
    const { db, from } = fakeDb({
      data: { id: LIST, updated_at: "2026-11-16 12:00:00.5+00", share_token: "tok", items: [row] },
      error: null,
    });
    const result = await saveChecked(db, "user-1", { listId: LIST, version: "v1", rows: [] });
    expect(result).toEqual({
      ok: true,
      listId: LIST,
      shareToken: "tok",
      version: "2026-11-16 12:00:00.5+00",
      items: [expect.objectContaining({ id: row.id, name: "Kettle", addedAt: Date.parse(row.added_at) })],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("logs a failed save by id and code, never the message", async () => {
    const { db } = fakeDb({ data: null, error: { code: "23514", message: "name too long: Kettle for Mom" } });
    const result = await saveChecked(db, "user-1", { listId: LIST, version: "v1", rows: [] });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(lastEvent()).toEqual({ event: "list_save_failed", at: expect.any(String), user_id: "user-1", list_id: LIST, code: "23514" });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("readList", () => {
  it("logs a failed read by id and code, never the message", async () => {
    const { db } = fakeDb({ data: null, error: null }, { data: null, error: { code: "42P01", message: "secret detail" } });
    expect(await readList(db, LIST)).toEqual({ ok: false });
    expect(lastEvent()).toEqual({ event: "list_read_failed", at: expect.any(String), list_id: LIST, code: "42P01" });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("toRow source", () => {
  it("keeps a source the database accepts", () => {
    expect(toRow({ name: "Reel", priceCents: 100, source: "extension" })?.source).toBe("extension");
  });

  it("saves an unknown source as manual instead of failing the whole save", () => {
    expect(toRow({ name: "Reel", priceCents: 100, source: "made-up" as never })?.source).toBe("manual");
  });
});
