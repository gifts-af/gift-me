// The daily photo repair against the real local database and storage (E5): which gifts
// lists.photo_repair_candidates picks and in what order, the backoff rows the step writes,
// and a repair saving our own copy (has_photo turning on). Zinc and the store reader are
// faked (we don't own them). The database is shared, so candidates are narrowed to this
// file's gifts before the step sees them. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { toListPhotoJpeg } from "../lib/photo-jpeg";
import { repairMissingPhotos, type PhotoRepairDeps } from "../lib/photo-repair";

const stack = await localStack({ api: true, storage: true });
const dbUp = stack !== null;

const GUESSED = (asin: string) => `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`;

describe.skipIf(!dbUp)("photo repair on local Supabase", () => {
  const s = stack?.supabase;
  const admin = (s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null)!;
  const pg = new Client({ connectionString: LOCAL_DB });
  const users: string[] = [];
  const mine = new Set<string>();
  // This test's gifts only: the step and the checks see nothing else.
  let scope = new Set<string>();
  beforeEach(() => {
    scope = new Set();
  });

  async function owner(opts: { excluded?: boolean; activeInDays: number }): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({ email: `photo-repair-${randomUUID()}@example.test`, email_confirm: true });
    if (error) throw error;
    const id = data.user.id;
    users.push(id);
    if (opts.excluded) {
      await pg.query(
        `insert into concierge.accounts (user_id, metrics_excluded) values ($1, true)
         on conflict (user_id) do update set metrics_excluded = true`,
        [id],
      );
    }
    // A list touched in the future ranks these owners above anything else on the shared database.
    const list = await pg.query(
      `insert into lists.lists (owner_id, updated_at) values ($1, now() + make_interval(days => $2)) returning id`,
      [id, opts.activeInDays],
    );
    return list.rows[0].id as string;
  }

  async function gift(listId: string, g: { url?: string | null; image?: string | null; hasPhoto?: boolean; asin?: string | null; ageDays?: number }) {
    const id = randomUUID();
    mine.add(id);
    scope.add(id);
    await pg.query(
      `insert into lists.list_items (id, list_id, position, name, price_cents, product_url, image_url, has_photo, asin, source, added_at)
       values ($1, $2, 0, 'Gift', 1000, $3, $4, $5, $6, $7, now() - make_interval(days => $8))`,
      [id, listId, g.url ?? null, g.image ?? null, g.hasPhoto ?? false, g.asin ?? null, g.url ? "store-url" : "manual", g.ageDays ?? 0],
    );
    return id;
  }

  /** Claims (like a run) the top `limit`; this file's gifts rank first, their lists being touched in the future. */
  async function candidates(limit = 50): Promise<string[]> {
    const { data, error } = await admin
      .schema("lists")
      .rpc("photo_repair_candidates", { p_limit: limit, p_max_age_days: 60, p_claim_minutes: 15 });
    if (error) throw error;
    return (data ?? []).map((r) => r.item_id).filter((id) => scope.has(id));
  }

  /** The admin client, with the candidates narrowed to this file's gifts. */
  const ownOnly = new Proxy(admin, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "schema") return typeof value === "function" ? value.bind(target) : value;
      return (name: "lists") => {
        const schema = target.schema(name);
        return new Proxy(schema, {
          get(sc, p) {
            const v = Reflect.get(sc, p);
            if (p !== "rpc") return typeof v === "function" ? v.bind(sc) : v;
            return async (fn: string, args: Record<string, unknown>) => {
              const r = await (sc.rpc as unknown as (f: string, a: unknown) => Promise<{ data: { item_id: string }[] | null; error: unknown }>)(fn, args);
              return fn === "photo_repair_candidates" && r.data ? { ...r, data: r.data.filter((c) => scope.has(c.item_id)) } : r;
            };
          },
        });
      };
    },
  }) as SupabaseClient<Database>;

  const settings = async (key: string) => {
    const { data } = await admin.schema("concierge").rpc("setting_int", { p_key: key });
    if (typeof data !== "number") throw new Error(`missing ${key}`);
    return key === "photo_repair_per_run" ? 50 : data;
  };

  function deps(over: Partial<PhotoRepairDeps>): PhotoRepairDeps {
    return {
      db: ownOnly,
      lookUpAmazon: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
      readPage: vi.fn(async () => ({ ok: false as const, reason: "http_status" as const })),
      download: vi.fn(async () => ({ ok: false as const, reason: "network" as const })),
      toJpeg: toListPhotoJpeg,
      log: () => {},
      now: () => new Date(),
      ...over,
    };
  }

  beforeAll(async () => {
    if (dbUp) await pg.connect();
  });
  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
    for (const id of mine) await admin.storage.from("list-photos").remove([`${id}.jpg`]);
    // Removed gifts with a photo queued their files: leave the shared queue as it was.
    if (dbUp) await pg.query(`delete from lists.photo_deletions where path = any($1)`, [[...mine].map((id) => `${id}.jpg`)]);
    await pg.end().catch(() => {});
  });

  it("picks gifts with a link and no photo or the guessed one; skips uploads, other photos, typed-in and old gifts", async () => {
    const list = await owner({ activeInDays: 5 });
    const none = await gift(list, { url: "https://www.aritzia.com/us/en/product/x/1.html" });
    const guessed = await gift(list, { url: "https://www.amazon.com/dp/B0G5Z36T3N", image: GUESSED("B0G5Z36T3N"), asin: "B0G5Z36T3N" });
    await gift(list, { url: "https://www.amazon.com/dp/B000000001", image: "https://db.test/x.jpg", hasPhoto: true });
    await gift(list, { url: "https://shop.test/p/1", image: "https://shop.test/real.jpg" });
    await gift(list, { url: null, image: null });
    await gift(list, { url: "https://shop.test/p/old", ageDays: 61 });
    expect(new Set(await candidates())).toEqual(new Set([none, guessed]));
  });

  it("puts a real, active person's gift before a team account's when the run takes one", async () => {
    const teamList = await owner({ excluded: true, activeInDays: 30 });
    const realList = await owner({ activeInDays: 20 });
    const team = await gift(teamList, { url: "https://shop.test/team" });
    const real = await gift(realList, { url: "https://shop.test/real" });
    expect(team).not.toBe(real);
    const { data } = await admin
      .schema("lists")
      .rpc("photo_repair_candidates", { p_limit: 1, p_max_age_days: 60, p_claim_minutes: 15 });
    expect(data?.map((r) => r.item_id)).toEqual([real]);
  });

  it("claims what it picks, so an overlapping run doesn't pick the same gifts", async () => {
    const list = await owner({ activeInDays: 40 });
    const item = await gift(list, { url: "https://shop.test/claimed" });
    expect(await candidates()).toEqual([item]);
    expect(await candidates()).toEqual([]);
    const row = await pg.query(`select attempts, next_attempt_at > now() as held from lists.photo_repairs where item_id = $1`, [item]);
    expect(row.rows[0]).toEqual({ attempts: 0, held: true });
  });

  it("backs off after a failure, retries when due, and stops after the last attempt", async () => {
    const list = await owner({ activeInDays: 1 });
    const item = await gift(list, { url: "https://shop.test/backoff" });

    await repairMissingPhotos(settings, deps({}));
    const row = await pg.query(`select attempts, last_outcome, gave_up_at, next_attempt_at > now() + interval '23 hours' as waits from lists.photo_repairs where item_id = $1`, [item]);
    expect(row.rows[0]).toMatchObject({ attempts: 1, last_outcome: "http_status", gave_up_at: null, waits: true });
    expect(await candidates()).not.toContain(item);

    await pg.query(`update lists.photo_repairs set next_attempt_at = now() - interval '1 minute' where item_id = $1`, [item]);
    expect(await candidates()).toContain(item);

    await pg.query(`update lists.photo_repairs set attempts = 3, next_attempt_at = now() - interval '1 minute' where item_id = $1`, [item]);
    await repairMissingPhotos(settings, deps({}));
    const last = await pg.query(`select attempts, gave_up_at is not null as gave_up from lists.photo_repairs where item_id = $1`, [item]);
    expect(last.rows[0]).toEqual({ attempts: 4, gave_up: true });
    await pg.query(`update lists.photo_repairs set next_attempt_at = now() - interval '1 minute' where item_id = $1`, [item]);
    expect(await candidates()).not.toContain(item);
  });

  it("saves a found photo as our copy: has_photo on, image_url ours, the backoff row gone", async () => {
    const list = await owner({ activeInDays: 1 });
    const item = await gift(list, { url: "https://www.amazon.com/dp/B0G5Z36T3N", image: GUESSED("B0G5Z36T3N"), asin: "B0G5Z36T3N" });
    await pg.query(`insert into lists.photo_repairs (item_id, attempts, next_attempt_at) values ($1, 1, now() - interval '1 minute')`, [item]);
    const photo = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#3a6" } }).png().toBuffer();
    // The version a My list tab opened before the repair holds.
    const before = await pg.query(`select owner_id, to_json(updated_at) #>> '{}' as version from lists.lists where id = $1`, [list]);

    const result = await repairMissingPhotos(
      settings,
      deps({
        lookUpAmazon: vi.fn(async (asin: string) => ({
          ok: true as const,
          product: { productId: asin, name: null, priceCents: null, imageUrl: "https://m.media-amazon.com/images/I/x.jpg" },
        })),
        download: vi.fn(async () => ({ ok: true as const, bytes: photo })),
      }),
    );
    expect(result).toEqual({ repaired: 1, failed: 0 });
    const g = await pg.query(`select has_photo, image_url from lists.list_items where id = $1`, [item]);
    expect(g.rows[0].has_photo).toBe(true);
    expect(g.rows[0].image_url).toMatch(new RegExp(`/storage/v1/object/public/list-photos/${item}\\.jpg$`));
    expect((await pg.query(`select 1 from lists.photo_repairs where item_id = $1`, [item])).rowCount).toBe(0);
    expect((await pg.query(`select 1 from lists.photo_deletions where path = $1`, [`${item}.jpg`])).rowCount).toBe(0);
    const stored = await admin.storage.from("list-photos").download(`${item}.jpg`);
    expect(stored.error).toBeNull();

    // That stale tab can't save the old photo back: its version is out of date.
    await pg.query("begin");
    try {
      await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: before.rows[0].owner_id, role: "authenticated" })]);
      await pg.query("set local role authenticated");
      await expect(
        pg.query(`select lists.save_list_checked($1, 'My list', '[]'::jsonb, $2)`, [list, before.rows[0].version]),
      ).rejects.toMatchObject({ code: "GL409" });
    } finally {
      await pg.query("rollback");
    }

    // Removing the gift queues its stored photo, like an extension photo.
    await pg.query(`delete from lists.list_items where id = $1`, [item]);
    expect((await pg.query(`select 1 from lists.photo_deletions where path = $1`, [`${item}.jpg`])).rowCount).toBe(1);
    await pg.query(`delete from lists.photo_deletions where path = $1`, [`${item}.jpg`]);
  });

  it("takes repair lookups from the daily total, and refuses once it's used up", async () => {
    // In a transaction that's rolled back, so the shared ceiling and count are left as they were.
    await pg.query("begin");
    try {
      const used = Number((await pg.query(`select count(*) from lists.amazon_lookups where created_at >= now() - interval '1 day'`)).rows[0].count);
      await pg.query(`update concierge.app_settings set value = $1 where key = 'amazon_paste_lookups_per_day_total'`, [String(used + 1)]);
      expect((await pg.query(`select lists.take_repair_amazon_lookup() as ok`)).rows[0].ok).toBe(true);
      expect((await pg.query(`select count(*)::int as n from lists.amazon_lookups where user_id is null and created_at > now() - interval '1 minute'`)).rows[0].n).toBeGreaterThan(0);
      expect((await pg.query(`select lists.take_repair_amazon_lookup() as ok`)).rows[0].ok).toBe(false);
    } finally {
      await pg.query("rollback");
    }
  });
});
