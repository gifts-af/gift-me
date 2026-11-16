// @vitest-environment node
// The Supabase InboundStore (ALL-31 Task 5) on the service-role client: RLS doesn't apply, so
// each query must keep to the one user itself. Real local database (E5); skipped when it isn't
// running. Needs migration 20261116100000_inbound_notes.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import { createSupabaseInboundStore } from "../inbound/supabase-store";

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("createSupabaseInboundStore", () => {
  let pg: Client;
  const users: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const dadEmail = `dad-${tag}@gmail.com`;
  let userA: string;
  let userB: string;
  let personA: string;
  let personB: string;

  async function newUser(email: string): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, email],
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

  async function newNotification(userId: string, personId: string, messageId: string | null, providerId: string | null) {
    return (
      await pg.query(
        `insert into concierge.notifications (user_id, person_id, kind, channel, message_id, provider_message_id, sent_at)
         values ($1, $2, 'notes_tip', 'email', $3, $4, now()) returning id`,
        [userId, personId, messageId, providerId],
      )
    ).rows[0].id as string;
  }

  const store = () => {
    const s = stack!.supabase!;
    return createSupabaseInboundStore(
      createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
  };

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    userA = await newUser(dadEmail);
    userB = await newUser(`xdad-${tag}@gmail.com`);
    personA = await newPerson(userA, "Dad");
    personB = await newPerson(userB, "Dad");
  });
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  it("finds the account by its email ignoring case, and nothing else", async () => {
    const s = store();
    expect(await s.userByEmail(`Dad-${tag}@Gmail.com`)).toBe(userA);
    expect(await s.userByEmail(`dad-${tag}@gmail.co`)).toBeNull();
    expect(await s.userByEmail(`ad-${tag}@gmail.com`)).toBeNull();
    expect(await s.userByEmail("%@gmail.com")).toBeNull();
  });

  it("counts recorded events for today, per user", async () => {
    const s = store();
    expect(await s.countToday(userA)).toBe(0);
    await s.recordEvent(userA);
    await s.recordEvent(userA);
    expect(await s.countToday(userA)).toBe(2);
    expect(await s.countToday(userB)).toBe(0);
  });

  it("finds the person by Message-ID, with or without brackets, only within the user", async () => {
    const s = store();
    await newNotification(userB, personB, `<b-${tag}@ses.example>`, `rb-${tag}`);
    await newNotification(userA, personA, `<a-${tag}@ses.example>`, `ra-${tag}`);
    expect(await s.personForMessageId(userA, `<a-${tag}@ses.example>`)).toBe(personA);
    expect(await s.personForMessageId(userA, `a-${tag}@ses.example`)).toBe(personA);
    expect(await s.personForMessageId(userA, `<b-${tag}@ses.example>`)).toBeNull();
  });

  it("doesn't file to a deleted person", async () => {
    const s = store();
    const gone = await newPerson(userA, "Gone");
    await newNotification(userA, gone, `<gone-${tag}@ses.example>`, null);
    await pg.query("update public.people set deleted_at = now() where id = $1", [gone]);
    expect(await s.personForMessageId(userA, `<gone-${tag}@ses.example>`)).toBeNull();
  });

  it("lists the user's notifications with no Message-ID and backfills one", async () => {
    const s = store();
    const id = await newNotification(userA, personA, null, `rx-${tag}`);
    await newNotification(userB, personB, null, `ry-${tag}`);
    const pending = await s.unthreadedNotifications(userA, new Date(Date.now() - 86400000), 10);
    expect(pending).toEqual([{ id, providerMessageId: `rx-${tag}` }]);
    await s.setMessageId(userB, id, "<wrong-user@x>");
    await s.setMessageId(userA, id, `<x-${tag}@ses.example>`);
    expect(await s.personForMessageId(userA, `x-${tag}@ses.example`)).toBe(personA);
  });

  it("claims a one-time flag once", async () => {
    const s = store();
    expect(await s.claimFlag(userA, "notes_unpaid_reply_sent_at")).toBe(true);
    expect(await s.claimFlag(userA, "notes_unpaid_reply_sent_at")).toBe(false);
  });

  it("saves an asking message and lists live people", async () => {
    const s = store();
    const id = await s.saveAsking({ userId: userA, subject: "Ideas", body: "a fly rod", imagePath: null, imageType: null });
    const { rows } = await pg.query("select user_id, status, body from concierge.inbound_messages where id = $1", [id]);
    expect(rows).toEqual([{ user_id: userA, status: "asking", body: "a fly rod" }]);
    expect((await s.people(userA)).map((p) => p.id)).toContain(personA);
    expect((await s.people(userA)).map((p) => p.id)).not.toContain(personB);
  });

  it("reads its settings", async () => {
    const s = store();
    expect(await s.settings()).toEqual({ maxChoices: 5, maxPerDay: 20, linkHours: 72, threadLookupMax: 10, threadLookupDays: 60 });
    expect(typeof (await s.enabled())).toBe("boolean");
  });
});
