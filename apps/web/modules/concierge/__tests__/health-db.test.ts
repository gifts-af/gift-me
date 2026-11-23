// The health job against the real health_snapshot, settings and heartbeat (E5), with Resend and
// the vendors faked. The database is shared, so each test runs on its own far-future days,
// deletes its users afterwards, and checks its own ids. The snapshot's lists are global, so the
// tests that need nothing else open (no email, exact counts) first check that's so. Skipped when
// the local stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@gifts-af/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutgoingEmail } from "@/lib/resend";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { runHealthCheck } = await import("../health/run");
const { readSnapshot } = await import("../health/store");
const { addTickCounts, tickHeartbeat } = await import("../health/heartbeat");

const stack = await localStack({ api: true });

// What the privacy check looks for: the fixture user's name and email, the person's name and
// street, and the title on their list gift, idea and capture.
const PRIVATE = ["Jordan Rivera", "jordan.rivera@example.com", "Casey Rivera", "12 Elm Street", "Lego Castle"];

describe.skipIf(!stack)("runHealthCheck (real local database)", () => {
  const local = stack?.supabase;
  const db = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  let pg: Client;
  let log: { mock: { calls: unknown[][] } };
  let users: string[] = [];
  const beatDays: string[] = [];
  // A year no real tick or other test reaches, and a different month for each test, so the
  // heartbeat, idea run and capture windows never overlap.
  const year = 3000 + Math.floor(Math.random() * 5000);
  let month = 0;

  const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  /** A Monday or a Tuesday at 14:00 UTC, in a month of its own. */
  function dayIn(weekday: 1 | 2): { now: Date; today: string } {
    const first = new Date(Date.UTC(year, month++, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    const today = addDays(first.toISOString().slice(0, 10), offset + 7);
    return { now: new Date(`${today}T14:00:00Z`), today };
  }

  /** Today's tick, started at 12:00 and finished ok, written by the real heartbeat. */
  async function tickRan(today: string) {
    beatDays.push(today);
    await tickHeartbeat(db()).started(today, new Date(`${today}T12:00:00Z`));
    await tickHeartbeat(db()).finished(today, new Date(`${today}T12:04:00Z`), "ok", { roundsFailed: 0, fanoutFailed: 0 });
  }

  async function user(): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, now(), now())`,
      // Unique per test, and still holding the address the privacy check looks for.
      [id, `jordan.rivera@example.com.${id}.test`, JSON.stringify({ full_name: "Jordan Rivera" })],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [id]);
    const list = (await pg.query("insert into lists.lists (owner_id) values ($1) returning id", [id])).rows[0].id;
    await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Lego Castle', 4000)", [list]);
    return id;
  }

  /** A round for a fresh person at 12 Elm Street. */
  async function round(userId: string, status: string, reason: string | null, shipBy: string, attempts = 0): Promise<string> {
    const person = (
      await pg.query(
        `insert into public.people (user_id, name, relationship, address_line1, city, state, zip, country)
         values ($1, 'Casey Rivera', 'friend', '12 Elm Street', 'Dayton', 'OH', '45402', 'US') returning id`,
        [userId],
      )
    ).rows[0].id;
    const occasion = (
      await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, person])
    ).rows[0].id;
    return (
      await pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                            budget_cents, status, attention_reason, attempts)
         values ($1, $2, $3, 2030, $4::date + 10, $4::date, 5000, $5, $6, $7) returning id`,
        [userId, person, occasion, shipBy, status, reason, attempts],
      )
    ).rows[0].id;
  }

  /** An order on its own "Lego Castle" idea, created now: long before the test's tick. */
  async function order(roundId: string, status: string, holdReason: string | null = null): Promise<string> {
    const idea = (
      await pg.query(
        `insert into concierge.gift_ideas (user_id, person_id, round_id, title, price_cents, est_total_cents, rank, status)
         select user_id, person_id, id, 'Lego Castle', 4000, 4500, 1, 'selected' from concierge.gift_rounds where id = $1 returning id`,
        [roundId],
      )
    ).rows[0].id;
    return (
      await pg.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                       ship_to, ship_city, ship_state)
         select user_id, id, $2, 'zinc_wallet', 4500, 100, $3, $4, 'recipient', 'Dayton', 'OH' from concierge.gift_rounds where id = $1
         returning id`,
        [roundId, idea, status, holdReason],
      )
    ).rows[0].id;
  }

  /** An idea run that ran out of AI credit an hour before `at`. */
  async function noCreditRun(roundId: string, at: Date) {
    await pg.query(
      `insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
       select user_id, person_id, id, $2, $2, 'no_credit' from concierge.gift_rounds where id = $1`,
      [roundId, new Date(at.getTime() - 3_600_000)],
    );
  }

  const maxAttempts = async () => Number((await pg.query("select concierge.setting_int('round_max_attempts') as n")).rows[0].n);

  function deps(now: Date, aiCreditCents = 5000) {
    const sent: OutgoingEmail[] = [];
    const send = vi.fn(async (e: OutgoingEmail) => {
      sent.push(e);
      return { ok: true as const, id: "em_1" };
    });
    return {
      sent,
      deps: {
        db: db(),
        now,
        send,
        aiCredits: async () => aiCreditCents,
        zincBalance: async () => 5000,
        runbookBase: "https://example.test/operations.md",
      },
    };
  }

  const healthEvents = () =>
    log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => String(e.event).startsWith("health."));
  const checked = () => healthEvents().find((e) => e.event === "health.checked");
  const rows = (text: string) => text.split("\n").filter((l) => l.startsWith("- "));

  /** Nothing open from elsewhere that the snapshot would list or count on this day. */
  async function expectNothingElseOpen(now: Date) {
    const s = await readSnapshot(db(), now);
    const lists = [s.stuckRounds, s.unconfirmed, s.placingStale, s.heldZinc, s.deadlineClose, s.ideasWaiting];
    const w = s.weekly;
    const open = lists.reduce((n, l) => n + l.length, 0) + w.waitingAddress + w.waitingFunds + w.waitingSetup + w.waitingApproval;
    expect(open, "the shared local database has open rounds or orders left from elsewhere: run pnpm db:clean").toBe(0);
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    users = [];
  });
  afterAll(async () => {
    await pg.query("delete from concierge.tick_heartbeats where day = any($1::date[])", [beatDays]);
    await pg.end();
  });

  it("readSnapshot parses the real health_snapshot", async () => {
    const { now, today } = dayIn(2);
    await tickRan(today);
    const u = await user();
    const stuck = await round(u, "scheduled", null, addDays(today, 30), await maxAttempts());
    const snap = await readSnapshot(db(), now);
    expect(snap.tick.today).toMatchObject({ result: "ok", roundsFailed: 0, fanoutFailed: 0 });
    expect(snap.stuckRounds).toContainEqual({ roundId: stuck, userId: u, attempts: await maxAttempts() });
  });

  it("AC-1 on a Tuesday: one email, every flagged id, the unconfirmed round once", async () => {
    const { now, today } = dayIn(2);
    await tickRan(today);
    const u = await user();
    const far = addDays(today, 30);
    const max = await maxAttempts();
    const stuck = await round(u, "scheduled", null, far, max);
    const unconfRound = await round(u, "needs_attention", "unconfirmed", far, max);
    const unconfirmed = await order(unconfRound, "unconfirmed");
    const ordered = await round(u, "ordered", null, far);
    const placing = await order(ordered, "placing");
    const held = await order(ordered, "held", "retry");

    const { deps: d, sent } = deps(now);
    expect(await runHealthCheck(d)).toMatchObject({ result: "sent" });

    expect(sent).toHaveLength(1);
    for (const id of [stuck, unconfirmed, placing, held, u]) expect(sent[0].text).toContain(id);
    expect(sent[0].text.split(unconfRound)).toHaveLength(2);
    expect(checked()).toMatchObject({ result: "sent", sent: true, weekly: false });
  });

  /** Nothing the owner can act on: an address 20 days from its deadline, and a funds hold. */
  async function buyerWaits(today: string) {
    const u = await user();
    await round(u, "needs_address", null, addDays(today, 20));
    await order(await round(u, "needs_attention", "funds", addDays(today, 30)), "held", "funds");
  }

  it("AC-2: no email and health.checked {problems: 0, sent: false}", async () => {
    const { now, today } = dayIn(2);
    await expectNothingElseOpen(now);
    await tickRan(today);
    await buyerWaits(today);

    const { deps: d } = deps(now);
    expect(await runHealthCheck(d)).toEqual({ result: "quiet", problems: 0 });
    expect(d.send).not.toHaveBeenCalled();
    expect(checked()).toMatchObject({ result: "quiet", problems: 0, sent: false, weekly: false });
  });

  it("AC-3 on a Monday: the weekly email with All clear and the counts", async () => {
    const { now, today } = dayIn(1);
    await expectNothingElseOpen(now);
    await tickRan(today);
    await buyerWaits(today);

    const { deps: d, sent } = deps(now);
    expect(await runHealthCheck(d)).toEqual({ result: "sent", problems: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("All clear");
    expect(sent[0].text).toContain("All clear");
    expect(sent[0].text).toContain("1 waiting on an address");
    expect(sent[0].text).toContain("1 waiting on funds");
    expect(checked()).toMatchObject({ result: "sent", problems: 0, sent: true, weekly: true });
  });

  it("AC-7: on a Monday, two addTickCounts failures show in the weekly counts and a no_credit idea_runs row leads with Out of AI credit", async () => {
    const { now, today } = dayIn(1);
    beatDays.push(today);
    const at = new Date(`${today}T12:00:00Z`);
    await tickHeartbeat(db()).started(today, at);
    // Two queue jobs fail, added as the job route adds them.
    await addTickCounts(db(), today, at, { roundsFailed: 1 });
    await addTickCounts(db(), today, at, { roundsFailed: 1 });
    await tickHeartbeat(db()).finished(today, new Date(`${today}T12:04:00Z`), "ok", { roundsFailed: 0, fanoutFailed: 0 });
    const u = await user();
    await noCreditRun(await round(u, "generating", null, addDays(today, 30)), now);

    const { deps: d, sent } = deps(now);
    expect(await runHealthCheck(d)).toMatchObject({ result: "sent" });
    expect(rows(sent[0].text)[0]).toContain("Out of AI credit: ideas are paused");
    expect(sent[0].text).toContain("2 round steps failed");
  });

  it("AC-11: a generating round with no ideas within hold_final_days is listed under Out of AI credit", async () => {
    const { now, today } = dayIn(2);
    await tickRan(today);
    const u = await user();
    const waiting = await round(u, "generating", null, addDays(today, 1));
    const later = await round(u, "generating", null, addDays(today, 30));

    const { deps: d, sent } = deps(now, 0);
    expect(await runHealthCheck(d)).toMatchObject({ result: "sent" });
    const lead = rows(sent[0].text)[0];
    expect(lead).toContain("Out of AI credit: ideas are paused");
    expect(lead).toContain(waiting);
    expect(sent[0].text).not.toContain(later);
  });

  it("AC-14: health_email_enabled 0: the ping runs, send isn't called, result off", async () => {
    const { now, today } = dayIn(1);
    await tickRan(today);
    const was = (await pg.query("select value from concierge.app_settings where key = 'health_email_enabled'")).rows[0].value;
    await pg.query("update concierge.app_settings set value = '0' where key = 'health_email_enabled'");
    try {
      const { deps: d } = deps(now);
      // Records which tables the job reads, to see the ping.
      const tables: string[] = [];
      const client = d.db as unknown as { schema: (name: string) => { from: (t: string) => unknown } };
      const schema = client.schema.bind(client);
      client.schema = (name) => {
        const s = schema(name);
        const from = s.from.bind(s);
        s.from = (t) => {
          tables.push(t);
          return from(t);
        };
        return s;
      };

      expect(await runHealthCheck(d)).toEqual({ result: "off", problems: 0 });
      expect(tables).toEqual(["tick_heartbeats"]);
      expect(d.send).not.toHaveBeenCalled();
      expect(checked()).toMatchObject({ result: "off", sent: false });
    } finally {
      await pg.query("update concierge.app_settings set value = $1 where key = 'health_email_enabled'", [was]);
    }
  });

  it("AC-15: the fixture's name, email, street and gift titles are in no email or health event", async () => {
    // A Monday, so the weekly counts render too, with every kind of flagged item the user owns.
    const { now, today } = dayIn(1);
    await tickRan(today);
    const u = await user();
    const far = addDays(today, 30);
    const max = await maxAttempts();
    const stuck = await round(u, "scheduled", null, far, max);
    await order(await round(u, "needs_attention", "unconfirmed", far, max), "unconfirmed");
    const ordered = await round(u, "ordered", null, far);
    await order(ordered, "placing");
    await order(ordered, "held", "retry");
    await round(u, "needs_address", null, addDays(today, 1));
    await round(u, "generating", null, addDays(today, 1));
    await noCreditRun(stuck, now);
    await pg.query(
      `insert into concierge.captures (user_id, person_id, page_title, status, updated_at)
       select user_id, person_id, 'Lego Castle', 'failed', $2 from concierge.gift_rounds where id = $1`,
      [stuck, new Date(now.getTime() - 86_400_000)],
    );

    const { deps: d, sent } = deps(now, 0);
    expect(await runHealthCheck(d)).toMatchObject({ result: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(u);
    expect(sent[0].html).toEqual(expect.any(String));
    const where = { subject: sent[0].subject, html: sent[0].html!, text: sent[0].text, events: JSON.stringify(healthEvents()) };
    for (const [part, body] of Object.entries(where)) {
      for (const s of PRIVATE) expect(body.includes(s), `${s} in the ${part}`).toBe(false);
    }
  });
});
