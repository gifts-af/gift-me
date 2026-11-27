// The daily photo repair's steps, with Zinc, the store reader and the database faked; the
// image work (photo-jpeg.ts) is real. The candidates and the backoff against the real
// database are in ../../__tests__/photo-repair-db.test.ts.
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { afterFailure, repairMissingPhotos, type Candidate, type PhotoRepairDeps } from "../photo-repair";
import { toListPhotoJpeg } from "../photo-jpeg";

const NOW = new Date("2026-11-28T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ONE_BY_ONE_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const SETTINGS: Record<string, number> = {
  photo_repair_enabled: 1,
  photo_repair_per_run: 20,
  photo_repair_budget_ms: 60000,
  photo_repair_claim_minutes: 15,
  photo_repair_max_attempts: 4,
  photo_repair_backoff_days: 1,
  photo_repair_max_age_days: 60,
  photo_repair_min_px: 100,
  list_photo_width_px: 400,
  list_photo_jpeg_quality: 80,
  list_photo_max_bytes: 200000,
};
const settings = (over: Record<string, number> = {}) => async (key: string) => {
  const v = { ...SETTINGS, ...over }[key];
  if (v === undefined) throw new Error(`Setting ${key} is missing.`);
  return v;
};

const AMAZON: Candidate = {
  item_id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  product_url: "https://www.amazon.com/dp/B0G5Z36T3N",
  asin: "B0G5Z36T3N",
  image_url: "https://images-na.ssl-images-amazon.com/images/P/B0G5Z36T3N.01._SCLZZZZZZZ_.jpg",
  attempts: 0,
};
const ARITZIA: Candidate = {
  item_id: "33333333-3333-4333-8333-333333333333",
  owner_id: AMAZON.owner_id,
  product_url: "https://www.aritzia.com/us/en/product/sweater/123.html?color=1",
  asin: null,
  image_url: null,
  attempts: 0,
};

function fakeDb(candidates: Candidate[]) {
  const rpc = vi.fn(async (name: string) =>
    name === "photo_repair_candidates"
      ? { data: candidates, error: null }
      : { data: name === "save_repaired_photo" ? true : null, error: null },
  );
  const upsert = vi.fn(async () => ({ error: null }));
  const updates: Record<string, unknown>[] = [];
  const update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    const chain = {
      eq: () => chain,
      filter: () => chain,
      select: async () => ({ data: [{ id: "x" }], error: null }),
    };
    return chain;
  });
  const from = vi.fn((table: string) => (table === "photo_repairs" ? { upsert } : { update }));
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://db.test/storage/v1/object/public/list-photos/${path}` } }));
  const db = {
    schema: () => ({ rpc, from }),
    storage: { from: () => ({ upload, getPublicUrl }) },
  } as unknown as SupabaseClient<Database>;
  return { db, rpc, upsert, update, updates, upload };
}

async function realPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: "#c33" } }).png().toBuffer();
}

function deps(db: SupabaseClient<Database>, over: Partial<PhotoRepairDeps> = {}): PhotoRepairDeps {
  return {
    db,
    lookUpAmazon: vi.fn(async (asin: string) => ({
      ok: true as const,
      product: { productId: asin, name: "x", priceCents: 100, imageUrl: "https://m.media-amazon.com/images/I/real.jpg" },
    })),
    readPage: vi.fn(async () => ({ ok: false as const, reason: "http_status" as const })),
    download: vi.fn(async () => ({ ok: true as const, bytes: await realPhoto() })),
    toJpeg: toListPhotoJpeg,
    log: vi.fn(),
    now: () => NOW,
    ...over,
  };
}

describe("afterFailure", () => {
  it("doubles the wait after each failure and gives up at the max", () => {
    const s = { maxAttempts: 4, backoffDays: 1 };
    expect([1, 2, 3, 4].map((n) => (afterFailure(n, s, NOW).nextAttemptAt.getTime() - NOW.getTime()) / DAY)).toEqual([1, 2, 4, 8]);
    expect([1, 2, 3, 4].map((n) => afterFailure(n, s, NOW).gaveUp)).toEqual([false, false, false, true]);
  });
});

describe("repairMissingPhotos", () => {
  it("stores a found photo as our own JPEG copy and points the gift at it", async () => {
    const f = fakeDb([AMAZON]);
    const d = deps(f.db);
    expect(await repairMissingPhotos(settings(), d)).toEqual({ repaired: 1, failed: 0 });

    expect(d.lookUpAmazon).toHaveBeenCalledWith("B0G5Z36T3N", AMAZON.owner_id);
    expect(f.rpc).toHaveBeenCalledWith("photo_repair_candidates", { p_limit: 20, p_max_age_days: 60, p_claim_minutes: 15 });
    expect(f.rpc).toHaveBeenCalledWith("queue_photo", { p_item_id: AMAZON.item_id });
    const [path, body, opts] = f.upload.mock.calls[0] as unknown as [string, Buffer, { contentType: string }];
    expect(path).toBe(`${AMAZON.item_id}.jpg`);
    expect(opts.contentType).toBe("image/jpeg");
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(400);
    expect(f.rpc).toHaveBeenCalledWith("save_repaired_photo", {
      p_item_id: AMAZON.item_id,
      p_product_url: AMAZON.product_url,
      p_old_image_url: AMAZON.image_url,
      p_new_image_url: `https://db.test/storage/v1/object/public/list-photos/${AMAZON.item_id}.jpg`,
    });
    expect(f.upsert).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith("lists.photo_repaired", {
      item_id: AMAZON.item_id,
      user_id: AMAZON.owner_id,
      outcome: "repaired",
      store: "amazon.com",
      attempt: 1,
    });
  });

  it("refuses a 1x1 placeholder and schedules the next try a day out", async () => {
    const f = fakeDb([AMAZON]);
    const d = deps(f.db, { download: vi.fn(async () => ({ ok: true as const, bytes: ONE_BY_ONE_GIF })) });
    expect(await repairMissingPhotos(settings(), d)).toEqual({ repaired: 0, failed: 1 });
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalledWith("save_repaired_photo", expect.anything());
    expect(f.upsert).toHaveBeenCalledWith({
      item_id: AMAZON.item_id,
      attempts: 1,
      next_attempt_at: new Date(NOW.getTime() + DAY).toISOString(),
      last_outcome: "tiny_image",
      gave_up_at: null,
    });
  });

  it("doubles the wait after a later failure; the store's host is logged without its path or query", async () => {
    const f = fakeDb([{ ...ARITZIA, attempts: 2 }]);
    const d = deps(f.db);
    await repairMissingPhotos(settings(), d);
    expect(d.readPage).toHaveBeenCalledWith(ARITZIA.product_url, ARITZIA.owner_id);
    expect(f.upsert).toHaveBeenCalledWith({
      item_id: ARITZIA.item_id,
      attempts: 3,
      next_attempt_at: new Date(NOW.getTime() + 4 * DAY).toISOString(),
      last_outcome: "http_status",
      gave_up_at: null,
    });
    expect(d.log).toHaveBeenCalledWith("lists.photo_repair_failed", {
      item_id: ARITZIA.item_id,
      user_id: ARITZIA.owner_id,
      outcome: "http_status",
      store: "aritzia.com",
      attempt: 3,
      gave_up: false,
    });
  });

  it("gives up at the last allowed attempt", async () => {
    const f = fakeDb([{ ...ARITZIA, attempts: 3 }]);
    await repairMissingPhotos(settings(), deps(f.db));
    expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({ attempts: 4, gave_up_at: NOW.toISOString() }));
  });

  it("counts no attempt when today's lookups are used up, and asks Zinc no more this run", async () => {
    const f = fakeDb([AMAZON, { ...AMAZON, item_id: "44444444-4444-4444-8444-444444444444" }]);
    const lookUpAmazon = vi.fn(async () => ({ ok: false as const, reason: "over_limit" as const }));
    expect(await repairMissingPhotos(settings(), deps(f.db, { lookUpAmazon }))).toEqual({ repaired: 0, failed: 0 });
    expect(lookUpAmazon).toHaveBeenCalledTimes(1);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("starts no new gift once the run's time budget is spent", async () => {
    const f = fakeDb([ARITZIA, { ...ARITZIA, item_id: "55555555-5555-4555-8555-555555555555" }]);
    let t = NOW.getTime();
    const readPage = vi.fn(async () => {
      t += 60000;
      return { ok: false as const, reason: "http_status" as const };
    });
    const d = deps(f.db, { readPage, now: () => new Date(t) });
    expect(await repairMissingPhotos(settings(), d)).toEqual({ repaired: 0, failed: 1 });
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("reads a non-Amazon link with an ASIN-shaped id as a store page, never through Zinc", async () => {
    const other = { ...ARITZIA, product_url: "https://shop.test/product/ABCD123456/", asin: "ABCD123456" };
    const f = fakeDb([other]);
    const d = deps(f.db);
    await repairMissingPhotos(settings(), d);
    expect(d.lookUpAmazon).not.toHaveBeenCalled();
    expect(d.readPage).toHaveBeenCalledWith(other.product_url, other.owner_id);
  });

  it("counts no attempt and stops when photo downloads are switched off", async () => {
    const f = fakeDb([AMAZON, ARITZIA]);
    const d = deps(f.db, {
      readPage: vi.fn(async () => ({
        ok: true as const,
        product: { name: null, priceCents: null, imageUrl: "https://shop.test/x.jpg" } as never,
      })),
      download: vi.fn(async () => ({ ok: false as const, reason: "off" as const })),
    });
    expect(await repairMissingPhotos(settings(), d)).toEqual({ repaired: 0, failed: 0 });
    expect(d.download).toHaveBeenCalledTimes(1);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("does nothing with the switch off", async () => {
    const f = fakeDb([AMAZON]);
    expect(await repairMissingPhotos(settings({ photo_repair_enabled: 0 }), deps(f.db))).toEqual({ repaired: 0, failed: 0 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
