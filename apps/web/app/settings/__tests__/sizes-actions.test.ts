import { beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.hoisted(() => ({ user: "u1" as string | null, on: true, save: vi.fn(), remove: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: t.revalidate }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: t.user ? { claims: { sub: t.user } } : null }) } }),
}));
vi.mock("@/lib/account-sizes", async (original) => ({
  ...(await original<typeof import("@/lib/account-sizes")>()),
  sizesSharingOn: async () => t.on,
  saveMySizes: t.save,
  removeMySizes: t.remove,
}));
const { saveSizesAction, removeSizesAction } = await import("../sizes-actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("sizes actions", () => {
  beforeEach(() => {
    t.user = "u1";
    t.on = true;
    t.save.mockReset().mockResolvedValue(true);
    t.remove.mockReset().mockResolvedValue(true);
    t.revalidate.mockClear();
  });

  it("saves the whole row for the session's user and refreshes Settings (AC-3)", async () => {
    expect(await saveSizesAction(form({ top: "M", top_shared: "on" }))).toEqual({ ok: true });
    expect(t.save).toHaveBeenCalledOnce();
    expect(t.save).toHaveBeenCalledWith(expect.anything(), "u1", expect.objectContaining({ top: "M", top_shared: true, pants: null }));
    expect(t.revalidate.mock.calls.flat()).toEqual(["/settings", "/settings/sizes"]);
  });

  it("refuses a value that's too long, with the box it's in", async () => {
    const r = await saveSizesAction(form({ shoe: "x".repeat(31) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.shoe).toBeTruthy();
    expect(t.save).not.toHaveBeenCalled();
  });

  it("says so when the save fails", async () => {
    t.save.mockResolvedValue(false);
    expect((await saveSizesAction(form({ top: "M" }))).ok).toBe(false);
  });

  it("refuses to save when off, but Remove all still works (AC-10)", async () => {
    t.on = false;
    expect((await saveSizesAction(form({ top: "M" }))).ok).toBe(false);
    expect(t.save).not.toHaveBeenCalled();
    expect(await removeSizesAction()).toEqual({ ok: true });
    expect(t.remove).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("asks a signed-out person to sign in", async () => {
    t.user = null;
    expect((await saveSizesAction(form({ top: "M" }))).ok).toBe(false);
    expect((await removeSizesAction()).ok).toBe(false);
    expect(t.remove).not.toHaveBeenCalled();
  });
});
