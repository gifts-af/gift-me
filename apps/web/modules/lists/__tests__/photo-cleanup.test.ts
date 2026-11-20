// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { removeDeletedPhotos } from "../lib/photo-cleanup";

const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({ logEvent }));

function fake(paths: string[], removeError: string | null = null) {
  const rpc = vi.fn(async (name: string) =>
    name === "take_photo_deletions" ? { data: paths, error: null } : { data: null, error: null },
  );
  const remove = vi.fn(async () => ({ data: [], error: removeError ? { message: removeError } : null }));
  const from = vi.fn(() => ({ remove }));
  const db = { schema: () => ({ rpc }), storage: { from } } as unknown as SupabaseClient<Database>;
  return { db, rpc, remove, from };
}

describe("removeDeletedPhotos", () => {
  it("removes the taken files, then forgets them", async () => {
    const f = fake(["a.jpg", "b.jpg"]);
    expect(await removeDeletedPhotos(f.db)).toEqual({ removed: 2 });
    expect(f.rpc).toHaveBeenNthCalledWith(1, "take_photo_deletions", { p_limit: 500, p_older_than: "1 hour" });
    expect(f.from).toHaveBeenCalledWith("list-photos");
    expect(f.remove).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
    expect(f.rpc).toHaveBeenNthCalledWith(2, "forget_photo_deletions", { p_paths: ["a.jpg", "b.jpg"] });
  });

  it("forgets nothing and throws when the remove fails", async () => {
    const f = fake(["a.jpg"], "boom");
    await expect(removeDeletedPhotos(f.db)).rejects.toThrow("boom");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("list.photos_left", { count: 1 });
  });

  it("does nothing with no paths", async () => {
    const f = fake([]);
    expect(await removeDeletedPhotos(f.db)).toEqual({ removed: 0 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
