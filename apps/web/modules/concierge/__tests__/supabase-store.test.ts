// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    schema: () => ({ rpc, from: () => ({ upsert, update }) }),
  }),
}));

import { createSupabaseCaptureStore } from "../capture/supabase-store";

beforeEach(() => {
  rpc.mockReset();
  upsert.mockReset();
  update.mockReset();
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


describe("createSupabaseCaptureStore setCaptureStatus()", () => {
  // Records each filter the update is built with; awaiting it resolves with no error.
  function updateChain() {
    const filters: unknown[][] = [];
    const chain = {
      eq: (...a: unknown[]) => (filters.push(["eq", ...a]), chain),
      neq: (...a: unknown[]) => (filters.push(["neq", ...a]), chain),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    update.mockReturnValue(chain);
    return filters;
  }

  it("never lets a failed read replace one that already succeeded", async () => {
    const filters = updateChain();
    const store = await createSupabaseCaptureStore("t");
    await store!.setCaptureStatus("c1", "failed");
    expect(update).toHaveBeenCalledWith({ status: "failed" });
    expect(filters).toEqual([["eq", "id", "c1"], ["neq", "status", "extracted"]]);
  });

  it("marks a capture extracted whatever it was before", async () => {
    const filters = updateChain();
    const store = await createSupabaseCaptureStore("t");
    await store!.setCaptureStatus("c1", "extracted");
    expect(filters).toEqual([["eq", "id", "c1"]]);
  });
});
