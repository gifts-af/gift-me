import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, update, eq, getClaims } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  getClaims: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims }, from: () => ({ update }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/modules/concierge", () => ({}));
vi.mock("@/lib/wiring", () => ({ placeHeld: vi.fn(), zincWiring: vi.fn() }));

import { saveDisplayName } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } } });
  update.mockReturnValue({ eq });
  eq.mockResolvedValue({ error: null });
});

// ALL-136: the name a shared list shows, from public.profiles.display_name only.
describe("saveDisplayName", () => {
  it("saves the trimmed name on the signed-in profile and revalidates", async () => {
    expect(await saveDisplayName("  Aaron  ")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ display_name: "Aaron" });
    expect(eq).toHaveBeenCalledWith("id", "u1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/name");
    expect(revalidatePath).toHaveBeenCalledWith("/lists");
  });

  it("clears the name when it's emptied", async () => {
    expect(await saveDisplayName("   ")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ display_name: null });
  });

  it("refuses a name over 80 characters", async () => {
    expect(await saveDisplayName("x".repeat(81))).toEqual({ ok: false, error: "Keep your name to 80 characters." });
    expect(update).not.toHaveBeenCalled();
  });

  it("asks to sign in again without a session", async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await saveDisplayName("Aaron")).toEqual({ ok: false, error: "Your session ended. Sign in again." });
    expect(update).not.toHaveBeenCalled();
  });

  it("says so, and logs by id only, when the save fails", async () => {
    eq.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await saveDisplayName("Aaron")).toEqual({ ok: false, error: "Your name couldn't be saved. Try again." });
    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events[0]).toMatchObject({ event: "settings.display_name_save_failed", user_id: "u1" });
    expect(JSON.stringify(events)).not.toContain("Aaron");
    log.mockRestore();
  });
});
