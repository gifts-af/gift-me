// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    schema: () => ({ rpc }),
  }),
}));

import { createSupabaseCaptureStore } from "../capture/supabase-store";

beforeEach(() => {
  rpc.mockReset();
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
