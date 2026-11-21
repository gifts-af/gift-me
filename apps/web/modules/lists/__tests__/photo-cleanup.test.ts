// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { removeDeletedPhotos } from "../lib/photo-cleanup";

const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({ logEvent }));

beforeEach(() => logEvent.mockReset());

function fake(paths: string[], removeError: string | null = null) {
  const rpc = vi.fn(async (name: string) =>
    name === "take_photo_deletions" ? { data: paths, error: null } : { data: null, error: null },
  );
  const remove = vi.fn(async () => ({ data: [], error: removeError ? { message: removeError } : null }));
  const from = vi.fn(() => ({ remove }));
  const db = { schema: () => ({ rpc }), storage: { from } } as unknown as SupabaseClient<Database>;
  return { db, rpc, remove, from };
}

const SETTINGS: Record<string, number> = { list_photo_cleanup_batch: 50, list_photo_cleanup_min_age_minutes: 90 };
const readSetting = vi.fn(async (key: string) => {
  const value = SETTINGS[key];
  if (value === undefined) throw new Error(`Setting ${key} is missing.`);
  return value;
});

describe("removeDeletedPhotos", () => {
  it("takes a batch the size of the settings, removes the files, then forgets them", async () => {
    const f = fake(["a.jpg", "b.jpg"]);
    expect(await removeDeletedPhotos(f.db, readSetting)).toEqual({ removed: 2 });
    expect(readSetting).toHaveBeenCalledWith("list_photo_cleanup_batch");
    expect(readSetting).toHaveBeenCalledWith("list_photo_cleanup_min_age_minutes");
    expect(f.rpc).toHaveBeenNthCalledWith(1, "take_photo_deletions", { p_limit: 50, p_older_than: "90 minutes" });
    expect(f.from).toHaveBeenCalledWith("list-photos");
    expect(f.remove).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
    expect(f.rpc).toHaveBeenNthCalledWith(2, "forget_photo_deletions", { p_paths: ["a.jpg", "b.jpg"] });
  });

  it("skips the day, logging once with no detail, when a setting can't be read", async () => {
    const f = fake(["a.jpg"]);
    const broken = vi.fn(async (key: string) => {
      if (key === "list_photo_cleanup_min_age_minutes") throw new Error("missing");
      return 500;
    });
    expect(await removeDeletedPhotos(f.db, broken)).toEqual({ removed: 0 });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("list.photo_cleanup_skipped", { reason: "settings" });
  });

  it("forgets nothing and throws when the remove fails", async () => {
    const f = fake(["a.jpg"], "boom");
    await expect(removeDeletedPhotos(f.db, readSetting)).rejects.toThrow("boom");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("list.photos_left", { count: 1 });
  });

  it("does nothing with no paths", async () => {
    const f = fake([]);
    expect(await removeDeletedPhotos(f.db, readSetting)).toEqual({ removed: 0 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
