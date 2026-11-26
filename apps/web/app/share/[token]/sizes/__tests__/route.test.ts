import { describe, expect, it, vi } from "vitest";

const getOwnerSizes = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lists", () => ({ getOwnerSizes }));

import { GET } from "../route";

describe("GET /share/[token]/sizes (AC-9)", () => {
  it("returns the sizes as JSON, never cached", async () => {
    getOwnerSizes.mockResolvedValue([{ kind: "shoe", value: "10.5" }]);
    const response = await GET(new Request("http://x/share/t/sizes"), { params: Promise.resolve({ token: "t" }) });
    expect(getOwnerSizes).toHaveBeenCalledWith("t");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual([{ kind: "shoe", value: "10.5" }]);
  });
});
