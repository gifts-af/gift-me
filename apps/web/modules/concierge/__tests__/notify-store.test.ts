// @vitest-environment node
// The Supabase NotifyStore's "Who is this about?" parts (ALL-31 Task 8, AC-4) and the file_note
// action through it, against the real local database (E5): the link columns, and
// file_inbound_message letting only the first button win. Skipped when the stack isn't running.
// Needs migration 20261116100000_inbound_notes.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import type { Extract } from "@/lib/ai/extract";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { captureStoreFor } from "../capture/supabase-store";
import { createSupabaseInboundStore } from "../inbound/supabase-store";
import { confirmActionLink } from "../notify/links";
import { createSupabaseNotifyStore } from "../notify/store";
import { hashActionToken } from "../notify/tokens";

vi.mock("server-only", () => ({}));

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("createSupabaseNotifyStore: file_note links (ALL-31)", () => {
  let pg: Client;
  const users: string[] = [];
  let userA: string;
  let userB: string;
  let dad: string;
  let bob: string;
  const later = () => new Date(Date.now() + 60 * 60 * 1000);

  const client = () => {
    const s = stack!.supabase!;
    return createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  };

  async function newUser(): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, `fn-${id.slice(0, 8)}@example.com`],
    );
    return id;
  }

  async function newPerson(userId: string, name: string): Promise<string> {
    return (
      await pg.query("insert into public.people (user_id, name, relationship) values ($1, $2, 'father') returning id", [
        userId,
        name,
      ])
    ).rows[0].id as string;
  }

  async function asking(userId: string, subject: string, body: string): Promise<string> {
    return (
      await pg.query(
        "insert into concierge.inbound_messages (user_id, status, subject, body) values ($1, 'asking', $2, $3) returning id",
        [userId, subject, body],
      )
    ).rows[0].id as string;
  }

  const captureCount = async (messageId: string) =>
    (
      await pg.query(
        "select count(*)::int as n from concierge.captures c join concierge.inbound_messages m on m.capture_id = c.id where m.id = $1",
        [messageId],
      )
    ).rows[0].n as number;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    userA = await newUser();
    userB = await newUser();
    dad = await newPerson(userA, "Dad");
    bob = await newPerson(userA, "Bob");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  it("saves person_id and inbound_message_id, and findLink and claimLink return them", async () => {
    const store = createSupabaseNotifyStore(client());
    const messageId = await asking(userA, "Ideas", "a fly rod");
    const hash = hashActionToken(`tok-${randomUUID()}`);
    const expiresAt = later();
    await store.insertLinks([
      { hash, userId: userA, roundId: null, action: "file_note", expiresAt, personId: dad, inboundMessageId: messageId },
    ]);
    const { rows } = await pg.query("select person_id, inbound_message_id from concierge.action_links where token_hash = $1", [hash]);
    expect(rows).toEqual([{ person_id: dad, inbound_message_id: messageId }]);

    const want = { userId: userA, roundId: null, action: "file_note", personId: dad, inboundMessageId: messageId };
    expect(await store.findLink(hash)).toMatchObject({ ...want, usedAt: null });
    expect(await store.claimLink(hash, userA, new Date())).toMatchObject(want);
  });

  it("a link without them reads back nulls", async () => {
    const store = createSupabaseNotifyStore(client());
    const hash = hashActionToken(`tok-${randomUUID()}`);
    await store.insertLinks([{ hash, userId: userA, roundId: null, action: "test", expiresAt: later() }]);
    expect(await store.findLink(hash)).toMatchObject({ personId: null, inboundMessageId: null });
  });

  it("names only the user's live people", async () => {
    const store = createSupabaseNotifyStore(client());
    const gone = await newPerson(userA, "Gone");
    await pg.query("update public.people set deleted_at = now() where id = $1", [gone]);
    expect(await store.personName(userA, dad)).toBe("Dad");
    expect(await store.personName(userB, dad)).toBeNull();
    expect(await store.personName(userA, gone)).toBeNull();
  });

  it("files a message once, moving its text onto the capture, and refuses someone else's, a deleted person or a second time", async () => {
    const store = createSupabaseNotifyStore(client());
    const messageId = await asking(userA, "Ideas", "a fly rod");
    const gone = await newPerson(userA, "Gone");
    await pg.query("update public.people set deleted_at = now() where id = $1", [gone]);

    expect(await store.fileInboundMessage(userB, messageId, dad)).toBeNull();
    expect(await store.fileInboundMessage(userA, messageId, gone)).toBeNull();
    const captureId = await store.fileInboundMessage(userA, messageId, dad);
    expect(captureId).toEqual(expect.any(String));
    expect(await store.fileInboundMessage(userA, messageId, bob)).toBeNull();

    const { rows } = await pg.query("select person_id, page_title, text_excerpt from concierge.captures where id = $1", [captureId]);
    expect(rows).toEqual([{ person_id: dad, page_title: "Ideas", text_excerpt: "a fly rod" }]);
    expect(await captureCount(messageId)).toBe(1);
  });

  it("through the buttons: the first files and reads, another says already filed and creates nothing", async () => {
    const db = client();
    const store = createSupabaseNotifyStore(db);
    const messageId = await asking(userA, "", "wants a new fly rod");
    const tokens = { dad: `tok-${randomUUID()}`, bob: `tok-${randomUUID()}` };
    await store.insertLinks([
      { hash: hashActionToken(tokens.dad), userId: userA, roundId: null, action: "file_note", expiresAt: later(), personId: dad, inboundMessageId: messageId },
      { hash: hashActionToken(tokens.bob), userId: userA, roundId: null, action: "file_note", expiresAt: later(), personId: bob, inboundMessageId: messageId },
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const extract = vi.fn<Extract>(async () => []);
    const deps = {
      store,
      now: new Date(),
      notes: {
        captureStore: (userId: string) => captureStoreFor(db, userId),
        extract,
        inbound: createSupabaseInboundStore(db),
        notify: { store, channels: [], baseUrl: "https://giftsaf.test", now: new Date() },
      },
    };

    expect(await confirmActionLink(tokens.dad, userA, deps)).toMatchObject({ state: "done", done: { title: "Filed" }, next: `/people/${dad}` });
    const second = await confirmActionLink(tokens.bob, userA, deps);
    expect(second).toMatchObject({ state: "done", done: { title: "Already filed" } });
    expect(second).not.toHaveProperty("next");
    expect(await captureCount(messageId)).toBe(1);
    const { rows } = await pg.query(
      "select m.status, m.body, c.person_id from concierge.inbound_messages m join concierge.captures c on c.id = m.capture_id where m.id = $1",
      [messageId],
    );
    expect(rows).toEqual([{ status: "filed", body: null, person_id: dad }]);
  });
});
