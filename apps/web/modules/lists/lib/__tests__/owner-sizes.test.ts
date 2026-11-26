import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ schema: () => ({ rpc }) }) }));
vi.mock("@/lib/log", () => ({ logEvent, errorFields: () => ({}) }));

import { getOwnerSizes } from "../lists";

const TOKEN = "11111111-1111-4111-8111-111111111111";

describe("getOwnerSizes (AC-5, AC-7, AC-11)", () => {
  beforeEach(() => {
    rpc.mockReset();
    logEvent.mockReset();
  });

  it("gives the shared items", async () => {
    const data = [
      { kind: "shoe", value: "10.5" },
      { kind: "color", value: "Green" },
    ];
    rpc.mockResolvedValue({ data, error: null });
    expect(await getOwnerSizes(TOKEN)).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("owner_sizes", { p_token: TOKEN });
  });

  it("gives none for a malformed token without asking, and for null", async () => {
    expect(await getOwnerSizes("nope")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getOwnerSizes(TOKEN)).toEqual([]);
  });

  it("logs the code alone when the read fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: `${TOKEN} 10.5` } });
    expect(await getOwnerSizes(TOKEN)).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith("lists.owner_sizes_failed", { code: "42501" });
  });

  it("gives none and logs a code when the read throws", async () => {
    rpc.mockRejectedValue(Object.assign(new Error(`${TOKEN} 10.5`), { code: "ECONNRESET" }));
    expect(await getOwnerSizes(TOKEN)).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith("lists.owner_sizes_failed", { code: "ECONNRESET" });
    rpc.mockRejectedValue("boom");
    expect(await getOwnerSizes(TOKEN)).toEqual([]);
    expect(logEvent).toHaveBeenLastCalledWith("lists.owner_sizes_failed", { code: null });
  });

  it("gives none for a result that isn't a list, and keeps only well-formed entries", async () => {
    for (const data of [{}, "x", 3]) {
      rpc.mockResolvedValue({ data, error: null });
      expect(await getOwnerSizes(TOKEN)).toEqual([]);
    }
    rpc.mockResolvedValue({
      data: [{ kind: "shoe", value: "10" }, { kind: "boots", value: "9" }, { kind: "hat", value: 7 }, null, "x", { kind: "ring" }],
      error: null,
    });
    expect(await getOwnerSizes(TOKEN)).toEqual([{ kind: "shoe", value: "10" }]);
  });
});
