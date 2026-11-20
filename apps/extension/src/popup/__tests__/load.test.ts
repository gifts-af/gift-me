// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";
import { loadPopup } from "../load";

const db = {
  people: [
    { id: "a", name: "Ann" },
    { id: "b", name: "Bo" },
    { id: "c", name: "Cy" },
    { id: "d", name: "Di" },
  ],
  recent: [{ person_id: "c" }, { person_id: "a" }] as { person_id: string }[] | null,
  recentLimit: null as unknown,
  photoWidth: 400 as number | null,
};
vi.mock("../../lib/supabase", () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => ({ select: () => ({ order: async () => ({ data: db.people, error: null }) }) }),
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "has_paid_features") return { data: true, error: null };
        if (fn === "recent_people") {
          db.recentLimit = args.p_limit;
          return db.recent ? { data: db.recent, error: null } : { data: null, error: { message: "x" } };
        }
        const values: Record<string, number | null> = {
          capture_text_max_chars: 50000,
          capture_screenshot_max_bytes: 2500000,
          capture_read_estimate_cents: 2,
          list_photo_width_px: db.photoWidth,
          list_photo_jpeg_quality: 80,
        };
        const v = values[args.p_key as string];
        return v == null ? { data: null, error: { message: "missing" } } : { data: v, error: null };
      },
    }),
  }),
}));

let fake: FakeChrome;
beforeEach(() => {
  fake = installFakeChrome();
  db.recent = [{ person_id: "c" }, { person_id: "a" }];
  db.photoWidth = 400;
});

describe("loadPopup", () => {
  it("keeps the RPC's order for recent people and pads alphabetically to three", async () => {
    fake.scripting.blocked = true;
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(db.recentLimit).toBe(3);
    expect(r.recentPeople.map((p) => p.name)).toEqual(["Cy", "Ann", "Bo"]);
    expect(r.people).toHaveLength(4);
    expect(r.photoWidthPx).toBe(400);
    expect(r.photoJpegQuality).toBe(80);
  });

  it("a non-capturable tab gives page: null with the people still loaded", async () => {
    fake.scripting.blocked = true;
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(r.capturable).toBe(false);
    expect(r.page).toBeNull();
    expect(r.people).toHaveLength(4);
  });

  it("a capturable tab gives the read page", async () => {
    document.body.innerHTML = "<p>hi</p>";
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(r.capturable).toBe(true);
    expect(r.page?.pageUrl).toBe(location.href);
    expect(r.page?.product.isProduct).toBe(false);
  });

  it("a refused screenshot keeps the product: page without screenshot, scale or candidates", async () => {
    fake.tabs.captureVisibleTab = async () => {
      throw new Error("no capture");
    };
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(r.capturable).toBe(true);
    expect(r.page).toMatchObject({ screenshot: null, scale: null, candidates: [] });
    expect(r.recentPeople).toHaveLength(3);
  });

  it("a page script that fails gives page: null and not capturable, people still loaded", async () => {
    fake.scripting.executeScript = async () => [{ result: undefined }];
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(r.capturable).toBe(false);
    expect(r.page).toBeNull();
    expect(r.people).toHaveLength(4);
  });

  it("falls back to alphabetical when recent people can't be read", async () => {
    fake.scripting.blocked = true;
    db.recent = null;
    const r = await loadPopup();
    if (r.kind !== "ready") throw new Error("not ready");
    expect(r.recentPeople.map((p) => p.name)).toEqual(["Ann", "Bo", "Cy"]);
  });

  it("errors when a photo setting can't be read (T23)", async () => {
    db.photoWidth = null;
    expect(await loadPopup()).toEqual({ kind: "error" });
  });
});
