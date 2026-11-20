// @vitest-environment node
// Linking a person to a shared list, against the real local database (E5,
// ALL-123): each link status maps to its result, unlink keeps the person and
// their occasions, and a bad token is the "no longer works" copy, not a throw.
// Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";

let current: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));

const { saveList } = await import("../actions/lists");
const { getMyList, getSharedList, getPersonShareToken, getSharePreview } = await import("../lib/lists");
const { linkUnlinkedPerson, unlinkPerson } = await import("../lib/person-link");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

const NO_LONGER_WORKS = "This list link no longer works. Ask them for a new one.";

describe.skipIf(!dbUp)("linking a person to a shared list", () => {
  const s = stack?.supabase;
  const admin = s
    ? createClient(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const users: string[] = [];

  async function signedInClient(): Promise<{ db: SupabaseClient; id: string }> {
    const email = `person-link-${randomUUID()}@example.test`;
    const password = "local-only-password";
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { db, id: data.user.id };
  }

  async function listWithToken(): Promise<{ token: string; id: string; db: SupabaseClient }> {
    const owner = await signedInClient();
    current = owner.db;
    const saved = await saveList({ listId: null, version: null, items: [] });
    if (!saved.ok) throw new Error("save failed");
    const mine = await getMyList();
    return { token: mine!.list!.shareToken, id: owner.id, db: owner.db };
  }

  async function person(db: SupabaseClient, name: string): Promise<string> {
    const { data, error } = await db.schema("concierge").rpc("add_person", {
      p_name: name,
      p_relationship: "friend",
      p_kinds: ["birthday"],
      p_birthday_month: 5,
      p_birthday_day: 6,
    });
    if (error) throw error;
    return data as string;
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });

  it("links an unlinked person, and the list and token reads follow", async () => {
    const owner = await listWithToken();
    const buyer = await signedInClient();
    const pid = await person(buyer.db, "Sam");
    current = buyer.db;

    expect(await getPersonShareToken(pid)).toBeNull();
    const res = await linkUnlinkedPerson(owner.token, pid);
    expect(res.ok).toBe(true);
    expect(await getPersonShareToken(pid)).toBe(owner.token);

    const shared = await getSharedList(owner.token);
    expect(shared?.linkedPerson).toEqual({ id: pid, name: "Sam" });
    expect(shared).toHaveProperty("ownerName");
    const preview = await getSharePreview(owner.token);
    expect(preview?.itemCount).toBe(0);
    expect(await getSharePreview(randomUUID())).toBeNull();
  });

  it("says the person already has a list, and never replaces it", async () => {
    const first = await listWithToken();
    const second = await listWithToken();
    const buyer = await signedInClient();
    const pid = await person(buyer.db, "Sam");
    current = buyer.db;
    expect((await linkUnlinkedPerson(first.token, pid)).ok).toBe(true);
    const res = await linkUnlinkedPerson(second.token, pid);
    expect(res).toEqual({ ok: false, error: "Sam already has a list linked." });
    expect(await getPersonShareToken(pid)).toBe(first.token);
  });

  it("says the list already has another of the buyer's people, with that person's id", async () => {
    const owner = await listWithToken();
    const buyer = await signedInClient();
    const sam = await person(buyer.db, "Sam");
    const alex = await person(buyer.db, "Alex");
    current = buyer.db;
    expect((await linkUnlinkedPerson(owner.token, sam)).ok).toBe(true);
    const res = await linkUnlinkedPerson(owner.token, alex);
    expect(res).toEqual({ ok: false, error: "This list is already linked to Sam.", personId: sam });
  });

  it("refuses your own list, and an unknown or malformed token or person", async () => {
    const owner = await listWithToken();
    const pid = await person(owner.db, "Me");
    current = owner.db;
    expect(await linkUnlinkedPerson(owner.token, pid)).toEqual({ ok: false, error: "You can't link your own list." });

    const buyer = await signedInClient();
    const mine = await person(buyer.db, "Sam");
    current = buyer.db;
    expect(await linkUnlinkedPerson(randomUUID(), mine)).toEqual({ ok: false, error: NO_LONGER_WORKS });
    expect(await linkUnlinkedPerson("not-a-token", mine)).toEqual({ ok: false, error: NO_LONGER_WORKS });
    expect(await linkUnlinkedPerson(owner.token, randomUUID())).toEqual({ ok: false, error: NO_LONGER_WORKS });
  });

  it("unlink keeps the person and their occasions", async () => {
    const owner = await listWithToken();
    const buyer = await signedInClient();
    const pid = await person(buyer.db, "Sam");
    current = buyer.db;
    await linkUnlinkedPerson(owner.token, pid);

    expect(await unlinkPerson(pid)).toEqual({ ok: true });
    expect(await getPersonShareToken(pid)).toBeNull();
    const { data: p } = await buyer.db.from("people").select("id, name").eq("id", pid).single();
    expect(p?.name).toBe("Sam");
    const { data: occ } = await buyer.db.schema("concierge").from("occasions").select("id").eq("person_id", pid);
    expect(occ?.length).toBe(1);
  });
});
