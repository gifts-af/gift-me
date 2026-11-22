// lists.add_item against the real local database (E5, ALL-78): the match key in
// SQL gives the written answer (the rule is in core's link.ts header) for every
// case in match-key-cases.json, and adds racing each other or a My list save on many
// connections leave one gift, one list and a stale save refused. A 5 s
// statement timeout turns a deadlock into a failure. Skipped when the local
// database isn't running.
import { randomUUID } from "node:crypto";
import { productLink } from "@gifts-af/core/store-page/link";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cases from "./match-key-cases.json";
import { LOCAL_DB, localStack } from "../../../test/local-db";

const dbUp = (await localStack({ api: false })) !== null;

const MAX_ITEMS = 500;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(): Promise<Client> {
  const c = new Client({ connectionString: LOCAL_DB });
  await c.connect();
  await c.query("set statement_timeout = 5000");
  return c;
}

/** A connection acting as a signed-in user, the way PostgREST runs a request. */
async function connectAs(userId: string): Promise<Client> {
  const c = await connect();
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await c.query("set role authenticated");
  return c;
}

const addItem = (c: Client, url: string, name = "Yeti Mug") =>
  c.query<{ outcome: string; list_id: string }>(
    "select * from lists.add_item($1, $2, 3500, $3, null, null, false, $4)",
    [randomUUID(), name, url, MAX_ITEMS],
  );

const saveFirstList = (c: Client, name: string) =>
  c.query("select lists.save_list_checked(null, null, $1::jsonb, null) as r", [
    JSON.stringify([{ name, price_cents: 100 }]),
  ]);

/** Settles every promise, and reports each as an outcome or an error code. */
async function settle<T>(work: Promise<T>[], read: (value: T) => string): Promise<string[]> {
  const results = await Promise.allSettled(work);
  return results.map((r) => (r.status === "fulfilled" ? read(r.value) : `error:${(r.reason as { code?: string }).code}`));
}

describe.skipIf(!dbUp)("lists.add_item on local Supabase", () => {
  let admin: Client;
  const users: string[] = [];

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    if (users.length) await admin.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await admin.end();
  });

  async function newUser(): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, `add-item-${id}@example.test`],
    );
    return id;
  }

  async function connectMany(userId: string, n: number): Promise<Client[]> {
    return Promise.all(Array.from({ length: n }, () => connectAs(userId)));
  }

  const endAll = (clients: Client[]) => Promise.all(clients.map((c) => c.end()));

  const listCount = async (userId: string) =>
    (await admin.query("select count(*)::int as n from lists.lists where owner_id = $1", [userId])).rows[0].n as number;

  const itemNames = async (userId: string) =>
    (
      await admin.query(
        `select i.name from lists.list_items i join lists.lists l on l.id = i.list_id
          where l.owner_id = $1 order by i.position`,
        [userId],
      )
    ).rows.map((r) => r.name as string);

  it("gives the written match key and store host for every fixture case", async () => {
    const { rows } = await admin.query<{ url: string; key: string | null; host: string | null }>(
      `select c.url, lists.match_key(c.url, null) as key, lists.store_host(c.url) as host
         from jsonb_to_recordset($1::jsonb) as c (url text)`,
      [JSON.stringify(cases)],
    );
    expect(rows.map(({ url, key, host }) => ({ url, key, host }))).toEqual(
      cases.map(({ url, key, host }) => ({ url, key, host })),
    );
  });

  it("adds two sizes of a Shopify-style product as two gifts, and the same size once (B1)", async () => {
    const userId = await newUser();
    const [c] = await connectMany(userId, 1);
    const canonical = "https://tee.test/products/tee";
    const size = (variant: string) => productLink(`https://www.tee.test/products/tee?variant=${variant}`, canonical);
    try {
      const outcomes = [];
      for (const [url, name] of [[size("111"), "Tee S"], [size("222"), "Tee L"], [size("111"), "Tee S again"]]) {
        outcomes.push((await addItem(c, url, name)).rows[0].outcome);
      }
      expect(outcomes).toEqual(["added", "added", "duplicate"]);
    } finally {
      await endAll([c]);
    }
    expect((await itemNames(userId)).sort()).toEqual(["Tee L", "Tee S"]);
  });

  it("adds one gift when ten adds of the same product race, on a user with no list", async () => {
    const userId = await newUser();
    const clients = await connectMany(userId, 10);
    try {
      const outcomes = await settle(
        clients.map((c, i) => addItem(c, i % 2 ? "https://www.rei.com/product/123/yeti/" : "https://rei.com/product/123/yeti?ref=x")),
        (r) => r.rows[0].outcome,
      );
      expect(outcomes.sort()).toEqual(["added", ...Array(9).fill("duplicate")]);
    } finally {
      await endAll(clients);
    }
    expect(await listCount(userId)).toBe(1);
    expect(await itemNames(userId)).toEqual(["Yeti Mug"]);
  });

  it("leaves one list when adds and first My list saves race", async () => {
    const userId = await newUser();
    const clients = await connectMany(userId, 10);
    try {
      const outcomes = await settle(
        clients.map((c, i) =>
          i % 2 ? addItem(c, `https://shop.example.com/p/${i}`, `Gift ${i}`).then((r) => r.rows[0].outcome) : saveFirstList(c, `Saved ${i}`).then(() => "saved"),
        ),
        (o) => o,
      );
      // Every add lands; at most one first save wins, the rest are told to reload.
      expect(outcomes.filter((o) => o === "added")).toHaveLength(5);
      expect(outcomes.filter((o) => o !== "added").every((o) => o === "saved" || o === "error:GL409")).toBe(true);
      expect(outcomes.filter((o) => o === "saved").length).toBeLessThanOrEqual(1);
    } finally {
      await endAll(clients);
    }
    expect(await listCount(userId)).toBe(1);
    expect((await itemNames(userId)).filter((n) => n.startsWith("Gift"))).toHaveLength(5);
  });

  it("an add holding the lock makes a first save wait, then refuse (GL409)", async () => {
    const userId = await newUser();
    const [a, b] = await connectMany(userId, 2);
    try {
      await a.query("begin");
      expect((await addItem(a, "https://shop.example.com/p/1")).rows[0].outcome).toBe("added");
      let settled = false;
      const save = saveFirstList(b, "Mug").finally(() => (settled = true));
      save.catch(() => {});
      await pause(300);
      expect(settled, "the first save waits for the add").toBe(false);
      await a.query("commit");
      await expect(save).rejects.toMatchObject({ code: "GL409" });
    } finally {
      await endAll([a, b]);
    }
    expect(await listCount(userId)).toBe(1);
  });

  it("refuses a My list save made from the version read before an add (GL409)", async () => {
    const userId = await newUser();
    const [tab, ext] = await connectMany(userId, 2);
    try {
      const first = (await saveFirstList(tab, "Kettle")).rows[0].r as { id: string; updated_at: string; items: unknown[] };
      expect((await addItem(ext, "https://shop.example.com/p/2", "Novel")).rows[0].outcome).toBe("added");
      await expect(
        tab.query("select lists.save_list_checked($1, null, $2::jsonb, $3)", [first.id, JSON.stringify(first.items), first.updated_at]),
      ).rejects.toMatchObject({ code: "GL409" });
    } finally {
      await endAll([tab, ext]);
    }
    expect(await itemNames(userId)).toEqual(["Novel", "Kettle"]);
  });
});
