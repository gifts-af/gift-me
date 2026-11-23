import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { addDays, type CalendarDate, type Database } from "@gifts-af/core";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { LOCAL_DB, ownStaleOrders } from "../../../test/local-db";
import type { LocalSupabase } from "../../../e2e/local-supabase";
import type { Channel } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { approveAndBuy } from "../purchase/approve";
import { placeRound, sweepStalePlacing } from "../purchase/place";
import type { PurchaseDeps } from "../purchase/store";
import { advanceRound, type EngineDeps } from "../rounds/engine";
import { createSupabaseRoundStore } from "../rounds/store";
import { FakeZinc } from "./fake-zinc";
import { BASE } from "./round-engine-fakes";

// Held rounds against the real local database (E5), with only Zinc faked: the shared setup for
// the round-engine-held-*.test.ts files. Call heldRounds() inside a describe: it registers that
// describe's hooks and returns the helpers. pg, zinc, today and refuse change between tests, so
// read them from the returned object.

export type User = { userId: string; email: string };

export function heldRounds(local: LocalSupabase | null) {
  let pg: Client;
  const users: string[] = [];
  let zinc: FakeZinc;
  const before = new Map<string, string>();
  /** Every email sent, by recipient. */
  const mail: { to: string; subject: string; text: string; day: CalendarDate }[] = [];
  let today: CalendarDate;
  let clockDay: CalendarDate;

  // idea_engine_enabled ships 0; on here so a round's idea runs (a fake) are counted and told.
  const SHARED = ["zinc_ordering_enabled", "round_engine_enabled", "idea_engine_enabled"];
  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const key of SHARED) {
      before.set(key, (await pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);
      await pg.query("update concierge.app_settings set value = '1' where key = $1", [key]);
    }
    today = (await pg.query("select current_date::text as d")).rows[0].d;
  });
  afterAll(async () => {
    for (const [key, value] of before) await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  beforeEach(async () => {
    // Other test files flip these shared switches too, and put them back.
    for (const key of SHARED) await pg.query("update concierge.app_settings set value = '1' where key = $1", [key]);
    zinc = new FakeZinc((key) => users.some((u) => key === `zn_test_${u}`));
    refuse = false;
  });

  const client = () => createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false } });
  /** When set, the email service refuses every send. */
  let refuse = false;
  const refuseTo = new Set<string>();
  const channel: Channel = {
    name: "email",
    send: async (email) => {
      if (refuse || refuseTo.has(email.to)) return { ok: false as const, error: "Refused" };
      mail.push({ to: email.to, subject: email.subject, text: email.text, day: clockDay });
      return { ok: true as const, id: `msg-${mail.length}` };
    },
  };

  /** Day `n` from today: today itself is "now", later days are at noon UTC (rounds are due from midnight). */
  const dayAt = (n: number) => (n === 0 ? new Date(Date.now() + 1000) : new Date(`${addDays(today, n)}T12:00:00Z`));

  /** The engine and the buying side wired to each other, as the app's routes do it. */
  function wiring(now: Date, o: { zinc?: boolean; engineClock?: () => number } = {}): { engine: EngineDeps; purchase: PurchaseDeps } {
    clockDay = now.toISOString().slice(0, 10);
    const clock = () => 0;
    const db = ownStaleOrders(client(), users);
    const purchase: PurchaseDeps = {
      db,
      http: { base: "https://zinc.test", timeoutMs: 1000, fetch: zinc.fetch },
      env: "test",
      webhookBaseUrl: BASE,
      now,
      settings: { feeCents: 100, marginPct: 10 },
      advanceRound: (roundId) => advanceRound(roundId, engine, { justPlaced: true }),
      sleep: async () => {},
      clock,
    };
    const engine: EngineDeps = {
      clock: o.engineClock ?? clock,
      store: createSupabaseRoundStore(db),
      notify: { store: createSupabaseNotifyStore(db), channels: [channel], baseUrl: BASE, now },
      now,
      generateIdeas: async () => ({ status: "off" }),
      zinc:
        o.zinc === false
          ? null
          : {
              placeRound: (id, lock, deadlineMs, opts) => placeRound(id, lock, purchase, { deadlineMs, ...opts }),
              sweep: () => sweepStalePlacing(purchase),
              wallet: async () => ({ balanceCents: zinc.balance, autoTopUp: false }),
              lookahead: async () => ({ cents: 0, atLeast: false }),
              walletUrl: "https://zinc.test/wallet",
            },
    };
    return { engine, purchase };
  }
  const engine = (now: Date) => wiring(now).engine;
  const advance = (roundId: string, n: number, o: { zinc?: boolean } = {}) => advanceRound(roundId, wiring(dayAt(n), o).engine);
  /** The buyer approves today: approveAndBuy places it and, on a hold or failure, the engine tells them at once. */
  async function approve(u: User, r: { roundId: string; ideaIds: string[] }) {
    return approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, wiring(dayAt(0)).purchase);
  }

  async function newUser(o: { connected?: boolean; autoTopUp?: boolean | null } = {}): Promise<User> {
    const userId = randomUUID();
    const email = `engine-${userId}@example.com`;
    users.push(userId);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [userId, email],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features, buyer_phone, auto_topup_on) values ($1, true, '5555550100', $2)", [
      userId,
      o.autoTopUp === undefined ? false : o.autoTopUp,
    ]);
    if (o.connected ?? true) await connect(userId);
    return { userId, email };
  }
  const connect = (userId: string) =>
    pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [userId, `zn_test_${userId}`, `zn_whsec_${randomUUID()}`, randomUUID()]);

  /** A round awaiting approval, deadline in 30 days; its gifts (7 days at worst) still arrive if bought on the last day. */
  async function newRound(u: User, o: { totals?: number[]; listItems?: (string | null)[]; deadlineIn?: number } = {}) {
    const person = await pg.query(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [u.userId],
    );
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.userId,
      person.rows[0].id,
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + $4::int + 10, current_date + $4::int, 20000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [u.userId, person.rows[0].id, occasion.rows[0].id, o.deadlineIn ?? 30],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    for (const [i, total] of (o.totals ?? [4200]).entries()) {
      const item = o.listItems?.[i] ?? null;
      // A list idea's person is linked to the item's list, as approve_round requires (AC-30a).
      if (item)
        await pg.query(
          `insert into lists.person_links (person_id, buyer_id, list_id, share_token)
           select $1, $2, l.id, l.share_token from lists.list_items li join lists.lists l on l.id = li.list_id where li.id = $3
           on conflict (person_id) do nothing`,
          [person.rows[0].id, u.userId, item],
        );
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, list_item_id)
         values ($1, $2, $3, 'https://shop.test/pending', $4, $4, 2, 3, 5, $5, $6, $7) returning id`,
        [u.userId, roundId, i === 0 ? "Stoneware mug set" : "Linen apron", total, i + 1, item ? "list" : "generated", item],
      );
      await pg.query("update concierge.gift_ideas set product_url = 'https://shop.test/p/' || id where id = $1", [idea.rows[0].id]);
      ideaIds.push(idea.rows[0].id);
    }
    return { roundId, ideaIds };
  }

  /** Approved the way approveAndBuy does it (held/retry), then "crashed" before placing. */
  async function approvedRound(u: User) {
    const { roundId, ideaIds } = await newRound(u);
    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [roundId])).rows[0].locked_until;
    const orders = ideaIds.map((id) => ({
      idea_id: id,
      max_price_cents: 4520,
      fee_cents: 100,
      ship_to: "recipient",
      address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
    }));
    await pg.query("select concierge.approve_round($1, $2, $3, $4)", [roundId, u.userId, lock, JSON.stringify(orders)]);
    await pg.query("select concierge.release_round($1, $2)", [roundId, lock]);
    return { roundId, ideaIds };
  }

  const roundRow = async (roundId: string) =>
    (
      await pg.query(
        "select status::text as status, attention_reason, hold_count, locked_until, next_action_at from concierge.gift_rounds where id = $1",
        [roundId],
      )
    ).rows[0];
  const orderRows = async (roundId: string) =>
    (
      await pg.query(
        `select o.status, o.hold_reason, o.failure_type from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
          where o.round_id = $1 order by i.rank, o.created_at`,
        [roundId],
      )
    ).rows;
  const sends = async (roundId: string) =>
    (await pg.query("select step from concierge.round_sends where round_id = $1 order by created_at, step", [roundId])).rows.map((r) => r.step);
  /** Subjects this user got, as "subject@day-number". */
  const inbox = (u: User) => mail.filter((m) => m.to === u.email).map((m) => `${m.subject}@${dayNumber(m.day)}`);
  const dayNumber = (d: CalendarDate) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  const walletReads = () => zinc.calls.filter((c) => c === "GET /wallet/me").length;
  /** The text of every email this user got. */
  const textFor = (u: User) => mail.filter((m) => m.to === u.email).map((m) => m.text);
  return {
    get pg() {
      return pg;
    },
    get zinc() {
      return zinc;
    },
    get today() {
      return today;
    },
    get refuse() {
      return refuse;
    },
    set refuse(value: boolean) {
      refuse = value;
    },
    users, before, mail, refuseTo, client, channel, dayAt, wiring, engine, advance, approve,
    newUser, connect, newRound, approvedRound, roundRow, orderRows, sends, inbox, dayNumber, walletReads, textFor,
  };
}
