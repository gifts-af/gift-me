import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ schema: () => ({ rpc }) }),
}));
const { appSettingInt } = await import("@/lib/app-settings");

describe("appSettingInt", () => {
  beforeEach(() => rpc.mockReset());

  it("reads a whole-number app setting", async () => {
    rpc.mockResolvedValue({ data: 14, error: null });
    await expect(appSettingInt("install_tip_snooze_days")).resolves.toBe(14);
    expect(rpc).toHaveBeenCalledWith("setting_int", { p_key: "install_tip_snooze_days" });
  });

  it("throws rather than inventing a default when the setting is missing (T23)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(appSettingInt("nope")).rejects.toThrow("nope");
  });

  it("throws when the read fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(appSettingInt("install_tip_snooze_days")).rejects.toThrow("boom");
  });

  it("reads through a client it is given, such as one signed in by bearer token", async () => {
    const own = vi.fn().mockResolvedValue({ data: 1, error: null });
    const db = { schema: () => ({ rpc: own }) } as unknown as Parameters<typeof appSettingInt>[1];
    await expect(appSettingInt("extension_add_enabled", db)).resolves.toBe(1);
    expect(own).toHaveBeenCalledWith("setting_int", { p_key: "extension_add_enabled" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
