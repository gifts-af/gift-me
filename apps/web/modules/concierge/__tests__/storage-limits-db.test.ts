// What storage takes, proved by real uploads to the real local storage, as a signed-in user and
// through the app's own stores (E5): each bucket's size ceiling and types, and the cap on files
// for an account without concierge access. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@gifts-af/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";

const cookieClient = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: cookieClient }));

const { IMAGE_EXTENSIONS } = await import("../capture/capture");
const { captureStoreFor } = await import("../capture/supabase-store");
const { createSupabaseInboundStore } = await import("../inbound/supabase-store");
const { importPeople } = await import("../people/service");
const { createSupabasePeopleStore } = await import("../people/store");

const stack = await localStack({ api: true, storage: true });
const s = stack?.supabase;
const password = `pw-${randomUUID()}`;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

type Db = SupabaseClient<Database>;

describe.skipIf(!stack)("storage limits (real local storage)", () => {
  let pg: Client;
  let admin: Db;
  let user: { id: string; db: Db };
  let capBefore: string;
  const users: string[] = [];
  const stored: { bucket: string; path: string }[] = [];

  const setting = async (key: string) => Number((await pg.query("select concierge.setting_int($1) as v", [key])).rows[0].v);
  const setCap = (value: string) =>
    pg.query("update concierge.app_settings set value = $1 where key = 'storage_files_per_account'", [value]);
  const giveAccess = () =>
    pg.query(
      "insert into concierge.accounts (user_id, concierge_access) values ($1, true) on conflict (user_id) do update set concierge_access = true",
      [user.id],
    );

  /** Null when stored, else the status storage refused it with. */
  async function upload(bucket: string, bytes: number, contentType: string, opts: { db?: Db; upsert?: boolean; path?: string } = {}) {
    const path = opts.path ?? `${user.id}/${randomUUID()}`;
    const { error } = await (opts.db ?? user.db).storage
      .from(bucket)
      .upload(path, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType, upsert: opts.upsert ?? false });
    if (!error) stored.push({ bucket, path });
    return error && (error as { statusCode?: string }).statusCode;
  }

  async function newUser() {
    const email = `storage-${randomUUID()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient<Database>(s!.url, s!.publishableKey, noSession);
    const signedIn = await db.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    return { id: data.user.id, db };
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    admin = createClient<Database>(s!.url, s!.serviceRoleKey, noSession);
    capBefore = (await pg.query("select value::text as value from concierge.app_settings where key = 'storage_files_per_account'")).rows[0].value;
  });
  afterAll(async () => {
    if (capBefore) await setCap(capBefore);
    for (const bucket of ["person-photos", "captures"]) {
      const paths = stored.filter((f) => f.bucket === bucket).map((f) => f.path);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    }
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    await setCap(capBefore);
    user = await newUser();
    cookieClient.mockResolvedValue(user.db);
  });

  describe.each([
    { bucket: "person-photos", ceiling: 1_048_576, types: ["image/jpeg", "image/png", "image/webp"], wrong: "image/gif" },
    { bucket: "captures", ceiling: 3_145_728, types: Object.keys(IMAGE_EXTENSIONS), wrong: "image/svg+xml" },
  ])("$bucket (AC-21)", ({ bucket, ceiling, types, wrong }) => {
    it("takes a file up to the ceiling and refuses one over it, from the server too", async () => {
      expect(await upload(bucket, ceiling, "image/jpeg")).toBeNull();
      expect(await upload(bucket, ceiling + 1, "image/jpeg")).toBe("413");
      expect(await upload(bucket, ceiling + 1, "image/jpeg", { db: admin })).toBe("413");
    });

    it("takes every type the app stores and refuses others", async () => {
      for (const type of types) expect(await upload(bucket, 1000, type), type).toBeNull();
      for (const type of [wrong, "text/html", "application/octet-stream"]) expect(await upload(bucket, 1000, type), type).toBe("415");
    });

    it("refuses a file past the cap, however it gets there, and takes it with access", async () => {
      await setCap("2");
      const first = `${user.id}/first`;
      expect(await upload(bucket, 1000, "image/jpeg", { path: first })).toBeNull();
      expect(await upload(bucket, 1000, "image/jpeg")).toBeNull();
      expect(await upload(bucket, 1000, "image/jpeg")).toBe("403");
      expect(await upload(bucket, 1000, "image/jpeg", { upsert: true })).toBe("403");
      // Replacing one in place is refused too.
      expect(await upload(bucket, 1000, "image/jpeg", { path: first, upsert: true })).toBe("403");
      const copy = `${user.id}/copy`;
      const copied = await user.db.storage.from(bucket).copy(first, copy);
      if (!copied.error) stored.push({ bucket, path: copy });
      expect(copied.error).not.toBeNull();
      // Removing one makes room for one.
      await user.db.storage.from(bucket).remove([first]);
      expect(await upload(bucket, 1000, "image/jpeg")).toBeNull();
      expect(await upload(bucket, 1000, "image/jpeg")).toBe("403");

      await giveAccess();
      expect(await upload(bucket, 1000, "image/jpeg")).toBeNull();
    });

    it("can't be filled past the cap by moving files in from the other bucket", async () => {
      const other = bucket === "captures" ? "person-photos" : "captures";
      await setCap("1");
      expect(await upload(bucket, 1000, "image/jpeg")).toBeNull();
      const path = `${user.id}/mover`;
      expect(await upload(other, 1000, "image/jpeg", { path })).toBeNull();
      const { error } = await user.db.storage.from(other).move(path, path, { destinationBucket: bucket });
      if (!error) stored.push({ bucket, path });
      expect(error).not.toBeNull();
    });

    it("keeps to your own folder, with access or without", async () => {
      const path = `${(await newUser()).id}/x`;
      expect(await upload(bucket, 1000, "image/jpeg", { path })).toBe("403");
      await giveAccess();
      expect(await upload(bucket, 1000, "image/jpeg", { path })).toBe("403");
    });
  });

  it("the extension's screenshot still uploads, at its largest", async () => {
    const path = `${user.id}/${randomUUID()}.jpg`;
    const bytes = await setting("capture_screenshot_max_bytes");
    await captureStoreFor(user.db, user.id).uploadScreenshot(path, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "image/jpeg");
    stored.push({ bucket: "captures", path });
  });

  it("an emailed note's image still uploads from the server, at its largest and past the cap", async () => {
    await setCap("0");
    const bytes = new Uint8Array(await setting("capture_screenshot_max_bytes"));
    for (const [type, ext] of Object.entries(IMAGE_EXTENSIONS)) {
      const path = `${user.id}/${randomUUID()}.${ext}`;
      await createSupabaseInboundStore(admin).uploadImage(path, bytes, type);
      stored.push({ bucket: "captures", path });
    }
  });

  describe("Google import", () => {
    async function importOne(bytes: number, type: string) {
      const row = {
        googleId: "people/c1",
        name: "Odalys",
        relationship: "friend" as const,
        birthday: null,
        birthYear: null,
        address: null,
        photoUrl: "https://lh3.googleusercontent.com/cm/ABC=s100",
      };
      const result = await importPeople(createSupabasePeopleStore(), [row], {
        fetch: async () => new Response(new Uint8Array(bytes), { headers: { "content-type": type } }),
        newId: randomUUID,
      });
      const { rows } = await pg.query("select photo_path from public.people where user_id = $1", [user.id]);
      const photo = rows[0].photo_path as string | null;
      if (photo) stored.push({ bucket: "person-photos", path: photo });
      return { result, photo };
    }

    it.each(["image/jpeg", "image/png", "image/webp"])("stores a %s photo up to the stored size", async (type) => {
      const { result, photo } = await importOne(await setting("person_photo_stored_max_bytes"), type);
      expect(result).toMatchObject({ ok: true, added: 1, photosMissed: 0 });
      expect(photo).toMatch(new RegExp(`^${user.id}/`));
    });

    it("skips a photo over the stored size before uploading it, and still adds the person", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { result, photo } = await importOne((await setting("person_photo_stored_max_bytes")) + 1, "image/jpeg");
      expect(result).toMatchObject({ ok: true, added: 1, photosMissed: 1 });
      expect(photo).toBeNull();
      expect(log).not.toHaveBeenCalled(); // No failed upload.
      log.mockRestore();
    });
  });
});
