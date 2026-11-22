// Adding a list's owner from its share link, against the real local database
// (E5, ALL-123 AC-21): the add and the link are one transaction, so a
// double-tapped Save makes one person, never two (two people would mean two
// gift rounds and a double buy, T18). The real-thing test behind the fake
// store in people.test.ts. Skipped when the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
let current: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));

const { createSupabasePeopleStore } = await import("../people/store");
const { addPerson } = await import("../people/service");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

const sam = (name = "Sam") => ({
  name,
  relationship: "friend",
  kinds: ["birthday" as const],
  birthday: { month: 5, day: 6 },
  birthYear: null,
  anniversary: null,
});

describe.skipIf(!dbUp)("adding a list's owner from its link", () => {
  const s = stack?.supabase;
  const admin = s
    ? createClient(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const users: string[] = [];

  async function signedInClient(): Promise<{ db: SupabaseClient; id: string }> {
    const email = `add-from-link-${randomUUID()}@example.test`;
    const password = "local-only-password";
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { db, id: data.user.id };
  }

  // Another user's list, made directly: this module can't reach inside the lists module (T19).
  async function listToken(): Promise<{ token: string; ownerId: string }> {
    const owner = await signedInClient();
    const { data, error } = await admin!
      .schema("lists")
      .from("lists")
      .insert({ owner_id: owner.id })
      .select("share_token")
      .single();
    if (error) throw error;
    return { token: data.share_token, ownerId: owner.id };
  }

  async function livePeople(db: SupabaseClient): Promise<{ id: string; linked_user_id: string | null }[]> {
    const { data, error } = await db.from("people").select("id, linked_user_id").is("deleted_at", null);
    if (error) throw error;
    return data;
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
  });

  it("adds and links in one go", async () => {
    const { token, ownerId } = await listToken();
    const buyer = await signedInClient();
    current = buyer.db;
    const id = await createSupabasePeopleStore().createPerson({ ...sam(), shareToken: token });
    expect(await livePeople(buyer.db)).toEqual([{ id, linked_user_id: ownerId }]);
  });

  it("makes exactly one person when Save is tapped twice at once", async () => {
    const { token } = await listToken();
    const buyer = await signedInClient();
    current = buyer.db;
    const store = createSupabasePeopleStore();

    const results = await Promise.allSettled([
      store.createPerson({ ...sam(), shareToken: token }),
      store.createPerson({ ...sam(), shareToken: token }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = (won[0] as PromiseFulfilledResult<string>).value;
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: "P0001", details: winner });
    expect((await livePeople(buyer.db)).map((p) => p.id)).toEqual([winner]);
  });

  it("maps the loser to the person already added, through the service", async () => {
    const { token } = await listToken();
    const buyer = await signedInClient();
    current = buyer.db;
    const store = createSupabasePeopleStore();
    const input = { name: "Sam", relationship: "friend" as const, birthday: null, birthYear: null, anniversary: null };

    const [a, b] = await Promise.all([addPerson(store, input, token), addPerson(store, input, token)]);
    const ok = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(refused).toEqual([
      { ok: false, error: "Sam is already in your people.", existingId: (ok[0] as { id: string }).id },
    ]);
    expect(await livePeople(buyer.db)).toHaveLength(1);
  });

  it("adds nobody when the link matches no list (gone, or its link reset)", async () => {
    const buyer = await signedInClient();
    current = buyer.db;
    const result = await addPerson(
      createSupabasePeopleStore(),
      { name: "Sam", relationship: "friend", birthday: null, birthYear: null, anniversary: null },
      randomUUID(),
    );
    expect(result).toEqual({ ok: false, error: "This list link no longer works. Ask them for a new one." });
    expect(await livePeople(buyer.db)).toEqual([]);
  });
});
