// The SQL in design/operations.md > Erasing data, run as it is written against the real local
// database on made-up rows (E5), so the runbook can't drift from the schema. Every test runs in a
// transaction that is rolled back. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_DB, localStack } from "./local-db";

const runbook = readFileSync(path.resolve(__dirname, "../../../design/operations.md"), "utf8").replaceAll("\r\n", "\n");
const section = runbook.split("\n## Erasing data\n")[1].split("\n## ")[0];
const blocksOf = (heading: string) => {
  const part = section.split(`\n### ${heading}\n`)[1].split("\n### ")[0];
  return [...part.matchAll(/^ *```sql\n([\s\S]*?)^ *```$/gm)].map((m) => m[1]);
};
const BEFORE = blocksOf("Before erasing anything");
const ACCOUNT = blocksOf("Erase an account");
const PERSON = blocksOf("Erase a person from an account");
const SEARCH = blocksOf("Erase what's kept about someone with no account");

const stack = await localStack({ api: false });

describe("the erase runbook", () => {
  it("has no SQL that the tests below don't run", () => {
    const counts = [BEFORE, ACCOUNT, PERSON, SEARCH].map((b) => b.length);
    expect(counts).toEqual([1, 7, 6, 1]);
    expect(section.match(/```sql/g)).toHaveLength(counts.reduce((a, b) => a + b));
  });
});

const ADDRESS = {
  recipient_first_name: "Zelda",
  recipient_last_name: "Quixby",
  address_line1: "19 Wren Hollow",
  city: "Dayton",
  state: "OH",
  zip: "45402",
  country: "US",
  phone: "9375550142",
};
const NONE = { THEIR_NAME: "none-given", THEIR_STREET: "none-given", THEIR_PHONE: "none-given" };

describe.skipIf(!stack)("the erase runbook's SQL (real local database)", () => {
  let pg: Client;
  /** Runs a runbook block with its placeholders filled in, as a person would. */
  const run = async (sql: string, values: Record<string, string> = {}) => {
    for (const [name, value] of Object.entries(values)) sql = sql.replaceAll(name, value);
    const left = sql.match(/\b(ACCOUNT_ID|ACCOUNT_EMAIL|PERSON_ID|ORDER_ID)\b/);
    if (left) throw new Error(`Nothing given for ${left[0]}`);
    return (await pg.query(sql)).rows;
  };
  const insert = async (table: string, row: Record<string, unknown>): Promise<string> => {
    const keys = Object.keys(row);
    const { rows } = await pg.query(
      `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
      Object.values(row),
    );
    return rows[0].id;
  };
  const rows = async (sql: string, ...values: unknown[]) => (await pg.query(sql, values)).rows;
  const count = async (table: string, where: string, value: string) =>
    Number((await rows(`select count(*) from ${table} where ${where}`, value))[0].count);

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(() => pg.end());
  beforeEach(async () => {
    await pg.query("begin");
  });
  afterEach(async () => {
    await pg.query("rollback");
  });

  async function user(name: string) {
    const id = randomUUID();
    const email = `erase-${id}@example.test`;
    const now = new Date();
    await insert("auth.users", {
      id,
      email,
      aud: "authenticated",
      role: "authenticated",
      raw_user_meta_data: { display_name: name },
      created_at: now,
      updated_at: now,
    });
    return { id, email };
  }

  const person = (userId: string, name: string) => insert("public.people", { user_id: userId, name, relationship: "friend" });

  async function order(userId: string, personId: string, status: string, extra: Record<string, unknown> = {}) {
    const occasion = await insert("concierge.occasions", { user_id: userId, person_id: personId, kind: "birthday", month: 3, day: 14 });
    const round = await insert("concierge.gift_rounds", {
      user_id: userId,
      person_id: personId,
      occasion_id: occasion,
      occasion_year: 2026,
      occasion_date: "2026-03-14",
      ship_by_deadline: "2026-03-05",
      budget_cents: 5000,
      status: status === "delivered" ? "complete" : "ordered",
    });
    const idea = await insert("concierge.gift_ideas", {
      user_id: userId,
      round_id: round,
      title: "Tea",
      price_cents: 100,
      est_total_cents: 100,
      rank: 1,
    });
    const id = await insert("concierge.orders", {
      user_id: userId,
      round_id: round,
      idea_id: idea,
      max_price_cents: 100,
      fee_cents: 0,
      funding_mode: "zinc_wallet",
      status,
      ship_to: "recipient",
      ship_city: "Dayton",
      ship_state: "OH",
      ...extra,
    });
    await insert("concierge.order_addresses", { order_id: id, user_id: userId, ...ADDRESS });
    return { id, round, idea };
  }

  const file = (bucket: string, name: string) => insert("storage.objects", { bucket_id: bucket, name });

  async function list(ownerId: string, gift: string) {
    const id = await insert("lists.lists", { owner_id: ownerId, title: "My list" });
    const item = await insert("lists.list_items", { list_id: id, position: 1, name: gift, price_cents: 100, has_photo: true });
    return { id, item };
  }

  it("finds an account by its email", async () => {
    const a = await user("Ada");
    expect(await run(BEFORE[0], { ACCOUNT_EMAIL: a.email })).toMatchObject([{ id: a.id }]);
  });

  it("erases an account, listing its files first, and its traces on other accounts", async () => {
    const a = await user("Ada");
    const b = await user("Bo");
    const gone = { ACCOUNT_ID: a.id, ACCOUNT_EMAIL: a.email };
    const mom = await person(a.id, "Mom");
    await order(a.id, mom, "delivered");
    await insert("concierge.accounts", { user_id: a.id, paid_features: true, concierge_access: true });
    await insert("public.account_addresses", { user_id: a.id, share_for_gifts: true, ...ADDRESS });
    const mine = await list(a.id, "Kettle");
    const theirs = await list(b.id, "Scarf");
    await insert("lists.gift_claims", { item_id: theirs.item, claimer_id: a.id, claimer_name: "Ada" });
    // One of B's orders names A's account; an older one carries only A's address.
    const friend = await person(b.id, "Ada");
    const newer = await order(b.id, friend, "delivered", { address_source: "shared", address_owner_id: a.id });
    const older = await order(b.id, await person(b.id, "Ada again"), "delivered", { address_source: "shared" });
    const unrelated = await order(b.id, await person(b.id, "Cy"), "delivered", { address_source: "own" });
    await insert("auth.flow_state", {
      id: randomUUID(),
      user_id: a.id,
      provider_type: "google",
      authentication_method: "oauth",
      provider_access_token: "made-up",
    });
    const log = (payload: object) => insert("auth.audit_log_entries", { id: randomUUID(), payload, ip_address: "" });
    await log({ action: "login", actor_id: a.id, actor_username: a.email });
    await log({ action: "user_signedup", actor_id: randomUUID(), traits: { user_id: a.id, user_email: a.email } });
    await log({ action: "user_recovery_requested", actor_username: a.email.toUpperCase() });
    await log({ action: "login", actor_id: b.id, actor_username: b.email });
    const photo = `${a.id}/${mom}/p.jpg`;
    const capture = `${a.id}/c.png`;
    await file("person-photos", photo);
    await file("captures", capture);
    await file("list-photos", `${mine.item}.jpg`);
    await file("person-photos", `${b.id}/${friend}/p.jpg`);
    const files = [capture, photo, `${mine.item}.jpg`].sort();

    const [stop, wait, , listFiles, erase, filesLeft, check] = ACCOUNT;
    await run(stop, gone);
    expect(await rows("select paid_features, concierge_access from concierge.accounts where user_id = $1", a.id)).toEqual([
      { paid_features: false, concierge_access: false },
    ]);
    expect(await run(wait, gone)).toEqual([]);
    expect((await run(listFiles, gone)).map((f) => f.name).sort()).toEqual(files);
    await run(erase, gone);

    expect(await run(check, gone)).toEqual([
      { accounts: "0", people: "0", lists: "0", sign_in_flows: "0", sign_in_log: "0", logged: "1" },
    ]);
    expect(await count("auth.audit_log_entries", "payload ->> 'actor_id' = $1", b.id)).toBe(1);
    expect(await rows("select claimer_id, claimer_name from lists.gift_claims where item_id = $1", theirs.item)).toEqual([
      { claimer_id: null, claimer_name: "Someone" },
    ]);
    for (const o of [newer, older]) {
      expect(await count("concierge.order_addresses", "order_id = $1", o.id)).toBe(0);
      expect(await rows("select ship_city, ship_state from concierge.orders where id = $1", o.id)).toEqual([
        { ship_city: "", ship_state: "" },
      ]);
    }
    expect(await count("concierge.order_addresses", "order_id = $1", unrelated.id)).toBe(1);
    expect(await count("lists.photo_deletions", "path = $1", `${mine.item}.jpg`)).toBe(1);
    const [logged] = await rows("select requested_by, reason from admin.deletion_log where target_id = $1", a.id);
    expect(JSON.stringify(logged)).not.toContain(a.email);

    // Only the Storage API removes the files, so the check after it still sees them here.
    const left = await run(filesLeft, { ...gone, "SAVED_NAME.jpg": `${mine.item}.jpg` });
    expect(left.map((f) => f.name).sort()).toEqual(files);
  });

  it.each(["placing", "unconfirmed", "placed", "shipped"])("won't erase an account with a %s gift", async (status) => {
    const a = await user("Ada");
    await order(a.id, await person(a.id, "Mom"), status);
    const gone = { ACCOUNT_ID: a.id, ACCOUNT_EMAIL: a.email };
    expect(await run(ACCOUNT[1], gone)).toMatchObject([{ status, theirs: true }]);
    await expect(run(ACCOUNT[4], gone)).rejects.toThrow(/still being ordered/);
  });

  it("won't erase an account whose shared address someone's gift is going to", async () => {
    const a = await user("Ada");
    const b = await user("Bo");
    await order(b.id, await person(b.id, "Ada"), "shipped", { address_source: "shared", address_owner_id: a.id });
    const gone = { ACCOUNT_ID: a.id, ACCOUNT_EMAIL: a.email };
    expect(await run(ACCOUNT[1], gone)).toMatchObject([{ status: "shipped", theirs: false }]);
    await expect(run(ACCOUNT[4], gone)).rejects.toThrow(/still being ordered/);
  });

  it.each(["placed", "shipped"])("a %s gift Zinc says arrived can be marked, and then the account erased", async (status) => {
    const a = await user("Ada");
    const b = await user("Bo");
    const gone = { ACCOUNT_ID: a.id, ACCOUNT_EMAIL: a.email };
    const mine = await order(a.id, await person(a.id, "Mom"), status);
    const theirs = await order(b.id, await person(b.id, "Ada"), status, { address_source: "shared", address_owner_id: a.id });
    const [stop, wait, arrived, , erase] = ACCOUNT;
    await run(stop, gone);
    expect(await run(wait, gone)).toHaveLength(2);
    for (const o of [mine, theirs]) {
      expect(await run(arrived, { ORDER_ID: o.id })).toEqual([{ round_status: "delivered", applied: true }]);
    }
    expect(await run(wait, gone)).toEqual([]);
    await run(erase, gone);
    expect(await count("auth.users", "id = $1", a.id)).toBe(0);
    expect(await count("concierge.order_addresses", "order_id = $1", theirs.id)).toBe(0);
  });

  it.each(["placing", "unconfirmed"])("a %s gift can't be marked as arrived", async (status) => {
    const a = await user("Ada");
    const { id } = await order(a.id, await person(a.id, "Mom"), status);
    expect(await run(ACCOUNT[2], { ORDER_ID: id })).toMatchObject([{ applied: false }]);
  });

  it("won't erase while a round is being worked on", async () => {
    const a = await user("Ada");
    const { round } = await order(a.id, await person(a.id, "Mom"), "delivered");
    await pg.query("update concierge.gift_rounds set locked_until = now() + interval '5 minutes' where id = $1", [round]);
    await expect(run(ACCOUNT[4], { ACCOUNT_ID: a.id, ACCOUNT_EMAIL: a.email })).rejects.toThrow(/being worked on/);
  });

  it("erases one person and leaves the rest of the account", async () => {
    const a = await user("Ada");
    const mom = await person(a.id, "Mom");
    const dad = await person(a.id, "Dad");
    const gone = { ACCOUNT_ID: a.id, PERSON_ID: mom };
    const capture = await insert("concierge.captures", { user_id: a.id, person_id: mom, screenshot_path: `${a.id}/c.png` });
    await insert("concierge.inbound_messages", { user_id: a.id, capture_id: capture, status: "filed", image_path: `${a.id}/n.png` });
    const unfiled = await insert("concierge.inbound_messages", { user_id: a.id, status: "asking", subject: "Hi" });
    await insert("concierge.notifications", { user_id: a.id, person_id: mom, kind: "notes_tip" });
    const bought = await order(a.id, mom, "delivered");
    await file("person-photos", `${a.id}/${mom}/p.jpg`);
    await file("person-photos", `${a.id}/${dad}/p.jpg`);

    const [find, hide, wait, listFiles, erase, check] = PERSON;
    expect((await run(find, gone)).map((p) => p.name)).toEqual(["Dad", "Mom"]);
    await run(hide, gone);
    expect(await count("public.people", "id = $1 and deleted_at is not null", mom)).toBe(1);
    expect(await run(wait, gone)).toEqual([]);
    expect((await run(listFiles, gone)).map((f) => f.name).sort()).toEqual(
      [`${a.id}/${mom}/p.jpg`, `${a.id}/c.png`, `${a.id}/n.png`].sort(),
    );
    await run(erase, gone);

    expect(await run(check, gone)).toEqual([{ people: "0", logged: "1" }]);
    expect(await count("concierge.orders", "id = $1", bought.id)).toBe(0);
    expect(await count("concierge.captures", "person_id = $1", mom)).toBe(0);
    expect(await rows("select id from concierge.inbound_messages where user_id = $1", a.id)).toEqual([{ id: unfiled }]);
    expect(await count("concierge.notifications", "user_id = $1", a.id)).toBe(0);
    expect(await count("public.people", "id = $1", dad)).toBe(1);
  });

  it("won't erase a person whose gift is on its way", async () => {
    const a = await user("Ada");
    const mom = await person(a.id, "Mom");
    await order(a.id, mom, "shipped");
    expect(await run(PERSON[2], { PERSON_ID: mom })).toMatchObject([{ status: "shipped" }]);
    await expect(run(PERSON[4], { PERSON_ID: mom })).rejects.toThrow(/still being ordered/);
  });

  /** One made-up row in every place the search covers, each carrying `words`. */
  async function scatter(words: string) {
    const a = await user("Ada");
    const p = await person(a.id, "Pal");
    const of = { user_id: a.id, person_id: p };
    const bought = await order(a.id, p, "delivered", { gift_message: words });
    await pg.query("update public.people set notes = $2 where id = $1", [p, words]);
    await pg.query("update concierge.order_addresses set address_line2 = $2 where order_id = $1", [bought.id, words]);
    await pg.query("update concierge.gift_ideas set reason = $2 where id = $1", [bought.idea, words]);
    await pg.query("update public.profiles set display_name = $2 where id = $1", [a.id, words]);
    await insert("public.account_addresses", { user_id: a.id, ...ADDRESS, address_line2: words });
    await insert("concierge.captures", { ...of, source_url: `https://x.test/${words}` });
    await insert("concierge.profile_facts", { ...of, category: "interest", value: words, source: "note" });
    await insert("concierge.questions", { ...of, prompt: "?", answer: words, status: "answered" });
    // Saving a gift checks that the signed-in user owns it.
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a.id })]);
    await insert("concierge.saved_gifts", { ...of, name: words });
    await insert("concierge.reactions", {
      user_id: a.id,
      round_id: bought.round,
      rating: "loved",
      source: "web",
      fact_category: "loved",
      fact_value: words,
    });
    await insert("concierge.rejections", { user_id: a.id, round_id: bought.round, reason_code: "has_it", reason_text: words });
    await insert("concierge.inbound_messages", { user_id: a.id, status: "asking", body: words });
    const l = await list(a.id, words);
    await pg.query("update lists.lists set title = $2 where id = $1", [l.id, words]);
    await insert("lists.gift_claims", { item_id: l.item, claimer_name: words });
    return { personId: p };
  }

  const EVERYWHERE = [
    "account",
    "account address",
    "answer",
    "capture",
    "claim",
    "emailed note",
    "fact",
    "gift idea",
    "gift message",
    "list gift",
    "list title",
    "order address",
    "person",
    "reaction",
    "rejection",
    "saved gift",
  ];

  it.each(["THEIR_NAME", "THEIR_STREET", "THEIR_PHONE"])("the search looks for %s everywhere it says", async (what) => {
    const words = `zq${randomUUID().slice(0, 8)}`;
    await scatter(words);
    const found = await run(SEARCH[0], { ...NONE, [what]: words });
    expect(found.map((f) => f.found_in).sort()).toEqual(EVERYWHERE);
  });

  it("the search finds nothing when nothing was given", async () => {
    await scatter(`zq${randomUUID().slice(0, 8)}`);
    expect(await run(SEARCH[0], NONE)).toEqual([]);
  });

  it("the search finds a person by birthday", async () => {
    const { personId } = await scatter(`zq${randomUUID().slice(0, 8)}`);
    const found = await run(SEARCH[0], { ...NONE, "0 as birth_month, 0 as birth_day": "3 as birth_month, 14 as birth_day" });
    expect(found).toContainEqual(expect.objectContaining({ found_in: "person", id: personId }));
  });
});
