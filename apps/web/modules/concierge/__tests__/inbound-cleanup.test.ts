// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { clearUnfiledNotes } from "../inbound/cleanup";

// The choosing (which messages, what is pruned) is the SQL function's job and is tested in
// supabase/tests/inbound_notes.test.sql. This covers what the app does with what it returns.

function fakeDb(rows: { message_id: string; image_path: string | null }[], removeError?: string) {
  const rpc = vi.fn(async (name: string) => ({ data: name === "clear_unfiled_inbound" ? rows : null, error: null }));
  const remove = vi.fn(async () => ({ data: null, error: removeError ? { message: removeError } : null }));
  const from = vi.fn(() => ({ remove }));
  const db = { schema: () => ({ rpc }), storage: { from } } as unknown as SupabaseClient<Database>;
  return { db, rpc, remove, from };
}

let log: MockInstance<typeof console.log>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe("clearUnfiledNotes", () => {
  it("deletes the cleared messages' images from the captures bucket", async () => {
    const f = fakeDb([
      { message_id: "m1", image_path: "u1/a.png" },
      { message_id: "m2", image_path: null },
      { message_id: "m3", image_path: "u2/b.jpg" },
    ]);
    await expect(clearUnfiledNotes(f.db)).resolves.toEqual({ cleared: 3, imagesRemoved: 2 });
    expect(f.rpc).toHaveBeenCalledWith("clear_unfiled_inbound");
    expect(f.from).toHaveBeenCalledWith("captures");
    expect(f.remove).toHaveBeenCalledWith(["u1/a.png", "u2/b.jpg"]);
    // Only after the files are gone are the image paths forgotten.
    expect(f.rpc).toHaveBeenLastCalledWith("forget_inbound_images", { p_message_ids: ["m1", "m3"] });
  });

  it("touches no storage when nothing was cleared or nothing had an image", async () => {
    const f = fakeDb([{ message_id: "m1", image_path: null }]);
    await expect(clearUnfiledNotes(f.db)).resolves.toEqual({ cleared: 1, imagesRemoved: 0 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalledWith("forget_inbound_images", expect.anything());
  });

  it("keeps the image paths when storage fails, and logs a count and the paths in chunks", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ message_id: `m${i}`, image_path: `u1/${i}.png` }));
    const f = fakeDb(rows, "bucket down");
    await expect(clearUnfiledNotes(f.db)).rejects.toThrow(/Removing 45 cleared note images failed/);
    expect(f.rpc).not.toHaveBeenCalledWith("forget_inbound_images", expect.anything());
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(lines.filter((l) => l.event === "inbound.note_images_left")).toEqual([expect.objectContaining({ count: 45 })]);
    const chunks = lines.filter((l) => l.event === "inbound.note_images_left_paths");
    expect(chunks).toHaveLength(3);
    expect(String(chunks[0].paths).split(",")).toHaveLength(20);
    expect(String(chunks[2].paths).split(",")).toHaveLength(5);
  });

  it("throws when the clear-out itself fails", async () => {
    const f = fakeDb([]);
    f.rpc.mockResolvedValueOnce({ data: null as never, error: { message: "boom" } as never });
    await expect(clearUnfiledNotes(f.db)).rejects.toThrow(/Clearing unfiled notes failed/);
  });
});
