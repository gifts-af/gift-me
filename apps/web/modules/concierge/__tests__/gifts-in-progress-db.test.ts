// The gifts in progress on Home and a person's page, on the real local database (E5): a signed-in
// user's client reads, so row-level security is the real thing. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { chooseBy, shortDate } from "@/lib/occasion-format";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { giftsInProgress } = await import("../rounds/in-progress");
const { roundView } = await import("../rounds/approval");

const stack = await localStack({ api: true });

describe.skipIf(stack === null)("giftsInProgress (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  const users: string[] = [];
  let pg: Client;
  const NOW = new Date();
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  async function newUser(paid = true) {
    const email = `progress-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, $2)", [data.user.id, paid]);
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return { id: data.user.id, db, rows: (personId?: string) => giftsInProgress(db, { now: NOW, leaveAfterDays: 14, personId }) };
  }
  type User = Awaited<ReturnType<typeof newUser>>;

  async function person(u: User, name = "Mary", o: { address?: boolean; linkedTo?: string } = {}) {
    const row = await pg.query(
      `insert into public.people (user_id, name, relationship, linked_user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip)
       values ($1, $2, 'friend', $3, $4, $5, $6, $7, $8, $9) returning id`,
      [u.id, name, o.linkedTo ?? null, ...(o.address ? ["Mary", "Allen", "12 Oak St", "Dayton", "OH", "45402"] : [null, null, null, null, null, null])],
    );
    return row.rows[0].id as string;
  }

  type Order = { status: string; est?: number; resolved?: boolean; failure?: string; idea?: number; shipTo?: string; delivered?: number };
  type Idea = { listItem?: string; status?: string };
  async function round(
    u: User,
    personId: string,
    o: { status?: string; kind?: string; shipBy?: number; reason?: string; closed?: boolean; ideas?: Idea[]; orders?: Order[]; year?: number } = {},
  ) {
    const kind = o.kind ?? "christmas";
    const occasion = await pg.query(
      `insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, $3)
       on conflict (person_id, kind) where deleted_at is null do update set kind = excluded.kind returning id`,
      [u.id, personId, kind],
    );
    const shipBy = o.shipBy ?? 20;
    const row = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status, attention_reason, closed_at)
       values ($1, $2, $3, $4, $5, $6, $7::concierge.round_status, $8, $9) returning id`,
      [u.id, personId, occasion.rows[0].id, o.year ?? 2030, day(shipBy + 9), day(shipBy), o.status ?? "awaiting_approval", o.reason ?? null, o.closed ? NOW : null],
    );
    const roundId = row.rows[0].id as string;
    const orders = o.orders ?? [];
    const ideas = o.ideas ?? orders.map(() => ({}) as Idea);
    const ideaIds: string[] = [];
    for (const [i, idea] of ideas.entries()) {
      const r = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, list_item_id, status)
         values ($1, $2, $3, 'Gift', 'https://shop.test/p', 4000, 4000, 2, 3, 5, $4, $5, $6, $7) returning id`,
        [u.id, roundId, personId, i + 1, idea.listItem ? "list" : "generated", idea.listItem ?? null, idea.status ?? "proposed"],
      );
      ideaIds.push(r.rows[0].id as string);
    }
    for (const [i, x] of orders.entries()) {
      await pg.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type, resolved, est_delivery_date, placed_at, ship_to, ship_city, ship_state, hold_reason, delivered_at)
         values ($1, $2, $3, 'zinc_wallet', 5000, 100, $4, $5, $6, $7, $8, $10, 'Dayton', 'OH', $9, $11)`,
        [
          u.id, roundId, ideaIds[x.idea ?? i], x.status, x.failure ?? null, x.resolved ?? false, x.est === undefined ? null : day(x.est),
          ["placed", "shipped", "delivered"].includes(x.status) ? NOW : null, x.status === "held" ? (o.reason ?? "funds") : null,
          x.shipTo ?? "recipient", x.delivered === undefined ? null : day(x.delivered),
        ],
      );
    }
    return roundId;
  }

  const said = async (u: User, personId?: string) => (await u.rows(personId)).map((g) => g.line.text);

  it("shows only the signed-in user's rounds, even asked for someone else's person", async () => {
    const [mine, theirs] = [await newUser(), await newUser()];
    const theirPerson = await person(theirs, "Secret");
    await round(theirs, theirPerson, { ideas: [{}] });
    await round(theirs, theirPerson, { status: "skipped", kind: "mothers_day", orders: [{ status: "shipped" }] });
    expect(await mine.rows()).toEqual([]);
    expect(await mine.rows(theirPerson)).toEqual([]);
    expect(await theirs.rows()).toHaveLength(2);
    // Rows of both, read together.
    const myPerson = await person(mine);
    const roundId = await round(mine, myPerson, { ideas: [{}, {}] });
    expect((await mine.rows()).map((g) => g.roundId)).toEqual([roundId]);
  });

  it("gives each row its person, occasion, date and line", async () => {
    const u = await newUser();
    const personId = await person(u, "Jenn");
    const roundId = await round(u, personId, { ideas: [{}, {}, { status: "rejected" }] });
    expect(await u.rows()).toEqual([
      {
        roundId,
        personId,
        personName: "Jenn",
        occasionKind: "christmas",
        date: day(20),
        line: { text: `2 ideas ready · Choose by ${chooseBy(day(20))}`, tone: "ready", needsBuyer: true },
      },
    ]);
  });

  it("lists what needs the buyer first, then by date, for everyone; a person's page has only theirs", async () => {
    const u = await newUser();
    const [a, b] = [await person(u, "Ann"), await person(u, "Bob")];
    const shipped = await round(u, a, { status: "ordered", shipBy: 2, orders: [{ status: "shipped", est: 5 }] });
    const later = await round(u, b, { shipBy: 30, ideas: [{}] });
    const sooner = await round(u, b, { kind: "mothers_day", shipBy: 10, ideas: [{}] });
    expect((await u.rows()).map((g) => g.roundId)).toEqual([sooner, later, shipped]);
    expect((await u.rows(a)).map((g) => g.line.text)).toEqual([`Shipped · due ${shortDate(day(5))}`]);
    expect((await u.rows(b)).map((g) => g.roundId)).toEqual([sooner, later]);
  });

  it.each([
    ["funds", "Waiting on your Zinc balance"],
    ["setup", "Waiting on payment setup"],
    ["address", "Needs an address"],
    ["paused", "Waiting to order"],
  ])("a %s hold", async (reason, says) => {
    const u = await newUser();
    await round(u, await person(u), { status: "needs_attention", reason, orders: [{ status: "held" }] });
    expect(await said(u)).toEqual([says]);
  });

  it("a failed gift needs a fix until it's resolved", async () => {
    const u = await newUser();
    const p = await person(u);
    await round(u, p, { status: "needs_attention", reason: "price_up", orders: [{ status: "failed", failure: "price_up" }, { status: "placed" }] });
    expect(await said(u)).toEqual([`Needs a fix · Choose by ${chooseBy(day(20))}`]);
    await pg.query("update concierge.orders set resolved = true where user_id = $1 and status = 'failed'", [u.id]);
    await pg.query("update concierge.gift_rounds set status = 'ordered', attention_reason = null where user_id = $1", [u.id]);
    expect(await said(u)).toEqual(["Ordered"]);
  });

  it("leaves out closed, skipped, complete and too-late rounds, but not one with a gift on its way", async () => {
    const u = await newUser();
    const p = await person(u);
    const gone: Parameters<typeof round>[2][] = [
      { closed: true, ideas: [{}] },
      { shipBy: 0, ideas: [{}] },
      { status: "skipped" },
      { status: "complete", orders: [{ status: "delivered" }] },
      { status: "skipped", orders: [{ status: "delivered" }] },
      { status: "skipped", orders: [{ status: "cancelled" }] },
    ];
    for (const [n, o] of gone.entries()) await round(u, p, { ...o, year: 2030 + n });
    expect(await u.rows()).toEqual([]);
    const still = await round(u, p, { status: "skipped", year: 2040, orders: [{ status: "shipped" }, { status: "failed", resolved: true }] });
    await round(u, p, { status: "delivered", year: 2041, orders: [{ status: "delivered" }] });
    const rows = await u.rows();
    expect(rows.map((g) => g.line.text).sort()).toEqual(["Delivered", expect.stringContaining("Shipped · due")]);
    expect(rows.map((g) => g.roundId)).toContain(still);
  });

  it("leaves out a deleted person's rounds, and still names a gift whose occasion was removed", async () => {
    const u = await newUser();
    const [a, b] = [await person(u, "Ann"), await person(u, "Bob")];
    await round(u, a, { status: "ordered", orders: [{ status: "shipped" }] });
    await round(u, b, { status: "ordered", orders: [{ status: "placed" }] });
    await pg.query("update public.people set deleted_at = now() where id = $1", [a]);
    await pg.query("update concierge.occasions set deleted_at = now() where person_id = $1", [b]);
    expect((await u.rows()).map((g) => [g.personName, g.occasionKind, g.line.text])).toEqual([["Bob", null, "Ordered"]]);
  });

  it("a gift leaves gift_progress_days after it arrived, or should have", async () => {
    const u = await newUser();
    const p = await person(u);
    const bought = (n: number, shipBy: number, orders: Order[], status = "ordered") => round(u, p, { status, shipBy, orders, year: 2030 + n });
    // The occasion is nine days after ship-by.
    await bought(0, -23, [{ status: "shipped", est: -20 }]);
    await bought(1, -40, [{ status: "shipped", est: -14 }]);
    await bought(2, -40, [{ status: "delivered", delivered: -14 }], "delivered");
    expect(await u.rows()).toEqual([]);
    const still = [
      await bought(3, -22, [{ status: "shipped", est: -20 }]),
      await bought(4, -40, [{ status: "shipped", est: -13 }]),
      await bought(5, -40, [{ status: "delivered", delivered: -13 }], "delivered"),
      await bought(6, -90, [{ status: "placing" }]),
    ];
    expect((await u.rows()).map((g) => g.roundId).sort()).toEqual(still.sort());
  });

  describe("a gift held for an address", () => {
    const heldRound = (u: User, p: string, orders: Order[] = [{ status: "held" }]) =>
      round(u, p, { status: "needs_attention", reason: "address", ideas: [{}], orders });

    it("goes by the address there is now", async () => {
      const u = await newUser();
      const p = await person(u);
      await heldRound(u, p);
      expect(await said(u)).toEqual(["Needs an address"]);
      await pg.query(
        "update public.people set recipient_first_name = 'Mary', recipient_last_name = 'Allen', address_line1 = '12 Oak St', city = 'Dayton', state = 'OH', zip = '45402' where id = $1",
        [p],
      );
      expect(await said(u)).toEqual(["Check the address"]);
    });

    it("is ours once an address is shared", async () => {
      const [u, owner] = [await newUser(), await newUser()];
      const p = await sharedPerson(u, owner, true);
      await heldRound(u, p);
      expect(await said(u)).toEqual(["Waiting to order"]);
    });

    it("still needs one the store couldn't use, and can't be helped by theirs when it goes elsewhere", async () => {
      const u = await newUser();
      for (const shipTo of ["recipient", "buyer"]) {
        const p = await person(u, "Mary", { address: true });
        const roundId = await heldRound(u, p, [
          { status: "failed", failure: "invalid_shipping_address", resolved: true, idea: 0, shipTo },
          { status: "held", idea: 0, shipTo },
        ]);
        expect(await said(u, p)).toEqual(["Needs an address"]);
        const view = await roundView(roundId, u.db, NOW);
        expect(view?.hold?.kind).toBe(shipTo === "recipient" ? "address" : "cancel_only");
      }
    });

    it("the round page says the same, and still opens when the address can't be read", async () => {
      const u = await newUser();
      const p = await person(u, "Mary", { address: true });
      const roundId = await heldRound(u, p);
      expect((await roundView(roundId, u.db, NOW))?.hold).toEqual({ kind: "check_address", text: "Check the address" });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      failRpc(u, "shared_city_for_person");
      expect((await roundView(roundId, u.db, NOW))?.hold).toEqual({ kind: "waiting", text: "Waiting to order" });
      expect(log.mock.calls.map((c) => String(c[0])).join()).toContain("round_hold_failed");
      log.mockRestore();
    });
  });

  /** A person linked to the owner's list, which shares the owner's address or not. */
  async function sharedPerson(u: User, owner: User, shares: boolean, name = "Mary") {
    const p = await person(u, name, { linkedTo: owner.id });
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id, share_token", [owner.id]);
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      p, u.id, list.rows[0].id, list.rows[0].share_token,
    ]);
    if (shares)
      await pg.query(
        `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
         values ($1, 'Mary', 'Allen', '9 Elm St', 'Dayton', 'OH', '45402', true)`,
        [owner.id],
      );
    const item = await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Vase', 3000) returning id", [list.rows[0].id]);
    lastItem = item.rows[0].id as string;
    return p;
  }
  let lastItem = "";

  /** Makes one database function fail for this person (or everyone). */
  function failRpc(u: User, name: string, personId?: string) {
    const broken = <T extends { rpc: (...a: never[]) => unknown }>(c: T) => {
      const real = c.rpc.bind(c) as (...a: unknown[]) => unknown;
      c.rpc = ((fn: string, args: { p_person_id?: string }) => {
        if (fn === name && (personId === undefined || args.p_person_id === personId))
          return Promise.resolve({ data: null, error: { code: "XX000", message: "down for jordan@example.com" } });
        return real(fn, args);
      }) as unknown as T["rpc"];
      return c;
    };
    broken(u.db as never);
    const schema = u.db.schema.bind(u.db);
    u.db.schema = ((s: "lists") => broken(schema(s) as never)) as unknown as typeof u.db.schema;
  }

  it("one person whose list or address can't be read never hides the others, and their line stays true", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const u = await newUser();
    const by = `Choose by ${chooseBy(day(20))}`;
    const bad = await sharedPerson(u, await newUser(), false, "Bad");
    await round(u, bad, { ideas: [{ listItem: lastItem }, {}] });
    await round(u, bad, { kind: "mothers_day", ideas: [{ listItem: lastItem }] });
    await round(u, bad, { kind: "fathers_day", status: "needs_address" });
    const good = await sharedPerson(u, await newUser(), true, "Good");
    await round(u, good, { ideas: [{ listItem: lastItem }] });
    await round(u, good, { kind: "fathers_day", status: "needs_address" });
    failRpc(u, "person_list", bad);
    failRpc(u, "shared_city_for_person", bad);
    const rows = await u.rows();
    expect(rows.filter((g) => g.personName === "Good").map((g) => g.line.text).sort()).toEqual([`1 idea ready · ${by}`, "Looking for ideas"]);
    expect(rows.filter((g) => g.personName === "Bad").map((g) => g.line.text).sort()).toEqual([by, `Ideas ready · ${by}`, "No ideas yet"].sort());
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("gift_progress_read_failed"))).toHaveLength(2);
    expect(lines.join()).toContain(bad);
    expect(lines.join()).not.toContain("jordan");
    log.mockRestore();
  });

  it("reads people's addresses only for rounds that use them", async () => {
    const u = await newUser();
    await round(u, await person(u, "Ann", { address: true }), { ideas: [{}] });
    const columns: string[] = [];
    const real = u.db.from.bind(u.db);
    u.db.from = ((table: "people") => {
      const q = real(table);
      const select = q.select.bind(q);
      q.select = ((c: string, opts: object) => (columns.push(c), select(c as "id", opts))) as unknown as typeof q.select;
      return q;
    }) as unknown as typeof u.db.from;
    expect(await u.rows()).toHaveLength(1);
    expect(columns).toEqual(["id, name"]);
  });

  it("nothing is cut off past one page of rounds", async () => {
    const u = await newUser();
    const p = await person(u);
    const o = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [u.id, p]);
    await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
       select $1, $2, $3, 2000 + n, $4, $5, 'awaiting_approval' from generate_series(1, 510) n where 2000 + n < 2999`,
      [u.id, p, o.rows[0].id, day(29), day(20)],
    );
    expect(await u.rows()).toHaveLength(510);
  });

  describe("waiting for ideas", () => {
    it("looking, then told, for a person with an address", async () => {
      const u = await newUser();
      const p = await person(u, "Mary", { address: true });
      const roundId = await round(u, p, { status: "scheduled" });
      expect(await said(u)).toEqual(["Looking for ideas"]);
      const tell = (sentAt: string | null, error: string | null, kind = "no_ideas", channel = "email") =>
        pg.query(
          "insert into concierge.notifications (user_id, round_id, person_id, kind, channel, sent_at, error) values ($1, $2, $3, $4, $5, $6, $7)",
          [u.id, roundId, p, kind, channel, sentAt, error],
        );
      await tell(null, "refused");
      await tell(NOW.toISOString(), null, "no_ideas", "push");
      await tell(NOW.toISOString(), null, "reminder");
      expect(await said(u)).toEqual(["Looking for ideas"]);
      await tell(NOW.toISOString(), null);
      expect(await said(u)).toEqual(["No ideas found yet"]);
    });

    it("without an address asks for one; a linked list's shared address counts", async () => {
      const [u, owner] = [await newUser(), await newUser()];
      const p = await person(u, "Mary", { linkedTo: owner.id });
      const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id, share_token", [owner.id]);
      await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
        p, u.id, list.rows[0].id, list.rows[0].share_token,
      ]);
      await round(u, p, { status: "needs_address" });
      expect(await said(u)).toEqual(["Needs an address"]);
      await pg.query(
        `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
         values ($1, 'Mary', 'Allen', '9 Elm St', 'Dayton', 'OH', '45402', true)`,
        [owner.id],
      );
      expect(await said(u)).toEqual(["Looking for ideas"]);
    });

    it("without paid features shows nothing, unless there are ideas to show", async () => {
      const u = await newUser(false);
      const p = await person(u, "Mary", { address: true });
      await round(u, p, { status: "generating" });
      expect(await u.rows()).toEqual([]);
      await round(u, p, { kind: "mothers_day", ideas: [{}] });
      expect(await said(u)).toEqual([`1 idea ready · Choose by ${chooseBy(day(20))}`]);
    });
  });

  it("counts only list gifts the buyer can still get", async () => {
    const [u, owner, rival] = [await newUser(), await newUser(), await newUser()];
    const p = await person(u, "Mary", { linkedTo: owner.id });
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id, share_token", [owner.id]);
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      p, u.id, list.rows[0].id, list.rows[0].share_token,
    ]);
    const items: string[] = [];
    for (const name of ["Vase", "Mug"]) {
      const r = await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, $2, $3, 3000) returning id", [list.rows[0].id, items.length, name]);
      items.push(r.rows[0].id as string);
    }
    await round(u, p, { ideas: items.map((listItem) => ({ listItem })) });
    const by = `Choose by ${chooseBy(day(20))}`;
    expect(await said(u)).toEqual([`2 ideas ready · ${by}`]);
    await pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name) values ($1, $2, 'Rival')", [items[0], rival.id]);
    expect(await said(u)).toEqual([`1 idea ready · ${by}`]);
    await pg.query("delete from lists.list_items where id = $1", [items[1]]);
    expect(await said(u)).toEqual(["No ideas left"]);
  });

  it("a failed read throws, for the page to log and show nothing", async () => {
    const u = await newUser();
    const real = u.db.from.bind(u.db);
    vi.spyOn(u.db, "from").mockImplementation(((table: string) => {
      if (table === "people") throw new Error("read failed");
      return real(table as "people");
    }) as unknown as typeof u.db.from);
    await round(u, await person(u), { ideas: [{}] });
    await expect(u.rows()).rejects.toThrow("read failed");
  });
});
