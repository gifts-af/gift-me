import { beforeEach, describe, expect, it, vi } from "vitest";

const settingInt = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/wiring", () => ({ settingInt }));
import { reactionsOpen } from "../reactions-open";

const NOW = new Date("2026-12-18T00:00:00Z");
beforeEach(() => void settingInt.mockReset().mockResolvedValue(1));

describe("reactionsOpen", () => {
  it.each([["2026-12-17", true], ["2026-12-18", true], ["2026-12-19", false]])("occasion on %s: %s", async (day, open) => {
    expect(await reactionsOpen({}, day, NOW)).toBe(open);
  });
  it("is closed while the switch is off", async () => {
    settingInt.mockResolvedValue(0);
    expect(await reactionsOpen({}, "2026-12-18", NOW)).toBe(false);
  });
  it("is closed, and breaks nothing, on a database without the switch", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    settingInt.mockRejectedValue(new Error("missing"));
    expect(await reactionsOpen({}, "2026-12-18", NOW)).toBe(false);
  });
});
