// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const upsert = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    schema: () => ({ rpc, from: () => ({ upsert }) }),
  }),
}));

import { createSupabaseCaptureStore } from "../capture/supabase-store";

beforeEach(() => {
  rpc.mockReset();
  upsert.mockReset();
});

describe("createSupabaseCaptureStore limits()", () => {
  it("reads both limits from settings", async () => {
    rpc.mockImplementation(async (...args: unknown[]) => ({
      data: (args[1] as { p_key: string }).p_key === "capture_text_max_chars" ? 5000 : 2_000_000,
      error: null,
    }));
    const store = await createSupabaseCaptureStore("t");
    expect(await store!.limits()).toEqual({ textMaxChars: 5000, screenshotMaxBytes: 2_000_000 });
  });

  it("rejects when a setting is missing (rpc returns null)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const store = await createSupabaseCaptureStore("t");
    await expect(store!.limits()).rejects.toThrow("setting capture_text_max_chars missing");
  });
});

describe("createSupabaseCaptureStore insertFacts()", () => {
  it("skips facts the person already has, so overlapping reads don't save twice", async () => {
    const select = vi.fn(async () => ({ data: [{ id: "f1", category: "wants", value: "vise" }], error: null }));
    upsert.mockReturnValue({ select });
    const store = await createSupabaseCaptureStore("t");
    const saved = await store!.insertFacts("p1", "c1", [{ category: "wants", value: "vise", confidence: 0.9 }]);
    expect(saved).toEqual([{ id: "f1", category: "wants", value: "vise" }]);
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toEqual([
      { user_id: "u1", person_id: "p1", category: "wants", value: "vise", source: "capture", source_id: "c1", confirmed: false },
    ]);
    expect(options).toEqual({ onConflict: "person_id,category,value_key", ignoreDuplicates: true });
  });
});

