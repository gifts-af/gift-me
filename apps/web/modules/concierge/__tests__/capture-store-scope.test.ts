// The capture store run with the service-role client (inbound email, ALL-31 Task 4):
// RLS doesn't apply, so every query must still keep to the one user. Real local
// database (E5); skipped when it isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));

const { captureStoreFor } = await import("../capture/supabase-store");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("captureStoreFor with the service-role client", () => {
  let pg: Client;
  const users: string[] = [];
  let userA: string;
  let personA: string;
  let captureA: string;
  let personB: string;
  let captureB: string;

  async function newUser(): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, `capture-scope-${id}@example.com`],
    );
    return id;
  }

  async function newPersonWithCapture(userId: string): Promise<{ person: string; capture: string }> {
    const person = (
      await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'Test', 'father') returning id", [userId])
    ).rows[0].id as string;
    const capture = (
      await pg.query(
        "insert into concierge.captures (user_id, person_id, page_title, text_excerpt) values ($1, $2, 'Note', 'text') returning id",
        [userId, person],
      )
    ).rows[0].id as string;
    await pg.query(
      `insert into concierge.profile_facts (user_id, person_id, category, value, source, source_id)
       values ($1, $2, 'interest', 'fly tying', 'capture', $3)`,
      [userId, person, capture],
    );
    return { person, capture };
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    userA = await newUser();
    const userB = await newUser();
    ({ person: personA, capture: captureA } = await newPersonWithCapture(userA));
    ({ person: personB, capture: captureB } = await newPersonWithCapture(userB));
  });
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });

  const storeForA = () => {
    const s = stack!.supabase!;
    const service = createClient<Database>(s.url, s.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return captureStoreFor(service, userA);
  };

  it("finds the user's own person and capture", async () => {
    const store = storeForA();
    expect(await store.personExists(personA)).toBe(true);
    expect(await store.loadCapture(captureA)).toMatchObject({ id: captureA, personId: personA });
    expect(await store.knownFacts(personA)).toEqual([{ category: "interest", value: "fly tying" }]);
  });

  it("reads the estimated cost of a read from its setting (ALL-144 AC-3)", async () => {
    const { rows } = await pg.query("select concierge.setting_int('capture_read_estimate_cents') as cents");
    expect(await storeForA().extractionSettings()).toMatchObject({ readEstimateCents: rows[0].cents });
  });

  it("can't find another user's person", async () => {
    expect(await storeForA().personExists(personB)).toBe(false);
  });

  it("can't load another user's capture or its facts", async () => {
    const store = storeForA();
    expect(await store.loadCapture(captureB)).toBeNull();
    expect(await store.knownFacts(personB)).toEqual([]);
    expect(await store.capturedFacts(captureB)).toEqual([]);
  });

  it("can't change or delete another user's capture", async () => {
    const store = storeForA();
    await store.setCaptureStatus(captureB, "failed");
    await store.setScreenshotPath(captureB, "x/y.png", "image/png");
    await store.deleteCapture(captureB);
    const { rows } = await pg.query("select status, screenshot_path from concierge.captures where id = $1", [captureB]);
    expect(rows).toEqual([{ status: "pending", screenshot_path: null }]);
  });
});
