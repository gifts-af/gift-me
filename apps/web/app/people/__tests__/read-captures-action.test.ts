import { expect, it, vi } from "vitest";

// "Read it now" on a person's page: the reads' costs are written with the service role, never
// the user's own session.

const { readUnreadCaptures, costRecorder, createAdminClient, recorder } = vi.hoisted(() => ({
  readUnreadCaptures: vi.fn(),
  costRecorder: vi.fn(),
  createAdminClient: vi.fn(),
  recorder: async () => {},
}));
vi.mock("../notes-tip", () => ({ scheduleNotesTip: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/wiring", () => ({}));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 20 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/modules/concierge", () => ({ readUnreadCaptures, costRecorder }));

import { readCapturesAction } from "../actions";

it("records each read's cost through the admin client (ALL-144 AC-13)", async () => {
  costRecorder.mockReturnValue(recorder);
  readUnreadCaptures.mockResolvedValue({ ok: true });
  const form = new FormData();
  form.set("personId", "p1");
  expect(await readCapturesAction(null, form)).toEqual({ ok: true });
  expect(readUnreadCaptures).toHaveBeenCalledWith(expect.any(Function), recorder, "p1");
  expect(costRecorder).toHaveBeenCalledWith(createAdminClient);
});
