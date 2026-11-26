// Saving one size from My list against the real local database and its row-level security
// (E5, T100): it writes only that size and its switch, only while that size is empty, and only
// the signed-in user's row. Skipped when the local stack isn't running; fails in CI then.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "@/test/local-db";
import { saveOneSize } from "../account-sizes";

vi.spyOn(console, "log").mockImplementation(() => {});

const stack = await localStack({ api: true });

describe.skipIf(!stack)("saveOneSize (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  const users: string[] = [];
  let pg: Client;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  async function newUser() {
    const email = `size-ask-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return { id: data.user.id, db };
  }

  const row = async (id: string) =>
    (await pg.query("select top, top_shared, hat, hat_shared, shoe, shoe_shared, color, color_shared from public.account_sizes where user_id = $1", [id]))
      .rows[0] ?? null;

  it("with no row yet, makes one holding only that size, shared", async () => {
    const u = await newUser();
    expect(await saveOneSize(u.db, u.id, "top", "M")).toBe("saved");
    expect(await row(u.id)).toEqual({
      top: "M",
      top_shared: true,
      hat: null,
      hat_shared: false,
      shoe: null,
      shoe_shared: false,
      color: null,
      color_shared: false,
    });
  });

  it("fills an empty size and leaves every other size and switch as it was", async () => {
    const u = await newUser();
    await pg.query(
      "insert into public.account_sizes (user_id, hat, hat_shared, color, color_shared) values ($1, '7 1/4', false, 'Green', true)",
      [u.id],
    );
    expect(await saveOneSize(u.db, u.id, "shoe", "9.5")).toBe("saved");
    expect(await row(u.id)).toEqual({
      top: null,
      top_shared: false,
      hat: "7 1/4",
      hat_shared: false,
      shoe: "9.5",
      shoe_shared: true,
      color: "Green",
      color_shared: true,
    });
  });

  it("never overwrites a size saved meanwhile, and never shares one kept private", async () => {
    const u = await newUser();
    await pg.query("insert into public.account_sizes (user_id, hat, hat_shared) values ($1, '7 1/4', false)", [u.id]);
    expect(await saveOneSize(u.db, u.id, "hat", "8")).toBe("already");
    expect(await row(u.id)).toMatchObject({ hat: "7 1/4", hat_shared: false });
  });

  it("can't touch another user's row", async () => {
    const me = await newUser();
    const other = await newUser();
    await pg.query("insert into public.account_sizes (user_id, hat) values ($1, '7')", [other.id]);
    // Even handed the other id, RLS keeps the update to its own row, and the insert is refused.
    expect(await saveOneSize(me.db, other.id, "top", "M")).toBe("failed");
    expect(await row(other.id)).toMatchObject({ top: null, top_shared: false, hat: "7" });
  });
});
