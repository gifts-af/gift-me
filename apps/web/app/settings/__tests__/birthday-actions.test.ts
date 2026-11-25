import { beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.hoisted(() => ({ user: "u1" as string | null, on: true, save: vi.fn(), remove: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: t.revalidate }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: t.user ? { claims: { sub: t.user } } : null }) } }),
}));
vi.mock("@/lib/account-birthday", () => ({
  birthdaySharingOn: async () => t.on,
  saveMyBirthday: t.save,
  removeMyBirthday: t.remove,
}));
const { saveBirthdayAction, removeBirthdayAction } = await import("../birthday-actions");

const form = (month: string, day: string) => {
  const f = new FormData();
  f.set("birthdayMonth", month);
  f.set("birthdayDay", day);
  return f;
};

describe("birthday actions", () => {
  beforeEach(() => {
    t.user = "u1";
    t.on = true;
    t.save.mockReset().mockResolvedValue(true);
    t.remove.mockReset().mockResolvedValue(true);
    t.revalidate.mockClear();
  });

  it("saves a real date, Feb 29 included, and refreshes Settings and the list (AC-2)", async () => {
    expect(await saveBirthdayAction(form("2", "29"))).toEqual({ ok: true });
    expect(t.save).toHaveBeenCalledWith(expect.anything(), "u1", { month: 2, day: 29 });
    expect(t.revalidate.mock.calls.flat()).toEqual(["/settings", "/settings/birthday", "/lists"]);
  });

  it.each([["", ""], ["3", ""], ["", "14"], ["2", "30"], ["x", "1"]])("refuses %j %j", async (m, d) => {
    expect((await saveBirthdayAction(form(m, d))).ok).toBe(false);
    expect(t.save).not.toHaveBeenCalled();
  });

  it("refuses to save when off, but still removes (AC-10)", async () => {
    t.on = false;
    expect((await saveBirthdayAction(form("3", "14"))).ok).toBe(false);
    expect(t.save).not.toHaveBeenCalled();
    expect(await removeBirthdayAction()).toEqual({ ok: true });
  });

  it("asks a signed-out person to sign in", async () => {
    t.user = null;
    expect((await saveBirthdayAction(form("3", "14"))).ok).toBe(false);
    expect((await removeBirthdayAction()).ok).toBe(false);
    expect(t.remove).not.toHaveBeenCalled();
  });
});
