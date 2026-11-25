// A search after "None of these" that finds nothing: the earlier ideas come back, with one email,
// in the run's own step. The real round store, SQL and rejection code against the local database
// (E5); only the idea run and the email channel are faked. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@gifts-af/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { IdeaOutcome } from "../ideas/run";
import { createSupabaseIdeaStore } from "../ideas/store";
import type { Channel } from "../notify/channels";
import { createSupabaseNotifyStore } from "../notify/store";
import { runRoundMessage, runTick, type EngineDeps } from "../rounds/engine";
import { createSupabaseRoundStore, type RoundStore } from "../rounds/store";
import type { ZincDeps } from "../zinc/types";
import { captureLog, named } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));
const { rejectionOutlook, rejectRoundIdeas, roundView } = await import("../rounds/approval");

const stack = await localStack({ api: true });
const NOTHING_NEW = "We didn't find anything new. These are still here if you want one.";
const NOT_FINISHED = "We couldn't finish looking. These are still here if you want one.";

captureLog();

describe.skipIf(!stack)("a search that finds nothing (real local database)", () => {
  const local = stack?.supabase;
  const client = (fetcher: typeof fetch = fetch) =>
    createClient<Database>(local!.url, local!.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  /** Every call to the database functions, and what some of them answer instead (by name). */
  function watched(answers: Record<string, (init?: RequestInit) => Response | null> = {}) {
    const calls: { fn: string; body: Record<string, unknown> }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const fn = url.pathname.split("/rpc/")[1];
      if (fn) calls.push({ fn, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return (fn ? answers[fn]?.(init) : null) ?? fetch(input, init);
    };
    return { fetcher, count: (fn: string) => calls.filter((c) => c.fn === fn).length, calls };
  }
  const noSuchFunction = () =>
    new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function", details: null, hint: null }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  const password = "local-only-password";
  let pg: Client;
  const users: string[] = [];
  const before = new Map<string, string>();
  const SWITCHES = { round_engine_enabled: 1, idea_engine_enabled: 1, restore_rejected_ideas_enabled: 1, idea_round_runs_max: 2, round_fanout_enabled: 0, idea_rounds_per_tick: 5, idea_round_runs_per_day: 100000, idea_run_lease_ms: 600000, moved_dates_close_rounds: 1 };
  const set = (key: string, value: number) => pg.query("update concierge.app_settings set value = $2 where key = $1", [key, String(value)]);

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    for (const key of Object.keys(SWITCHES)) {
      before.set(key, (await pg.query("select value::text as value from concierge.app_settings where key = $1", [key])).rows[0].value);
    }
  });
  beforeEach(async () => {
    for (const [key, value] of Object.entries(SWITCHES)) await set(key, value);
  });
  afterAll(async () => {
    for (const [key, value] of before) await pg.query("update concierge.app_settings set value = $2 where key = $1", [key, value]);
    for (const id of users) await client().auth.admin.deleteUser(id);
    await pg.end();
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  let mail: { subject: string; text: string }[];
  let refuse: boolean;
  beforeEach(() => {
    mail = [];
    refuse = false;
  });
  const channel: Channel = {
    name: "email",
    send: async (email) => {
      if (refuse) return { ok: false as const, error: "Refused" };
      mail.push({ subject: email.subject, text: email.text });
      return { ok: true as const, id: `msg-${mail.length}` };
    },
  };

  type Round = { userId: string; email: string; personId: string; roundId: string; ideaIds: string[] };
  /** A paid buyer's round awaiting approval: two ideas, a first run that saved them, its heads-up sent, one old fact. */
  async function newRound(o: { deadlineIn?: number; days?: number } = {}): Promise<Round> {
    const email = `no-new-ideas-${randomUUID()}@example.test`;
    const made = await client().auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error) throw made.error;
    const userId = made.data.user.id;
    users.push(userId);
    const one = async (sql: string, args: unknown[]) => (await pg.query(sql, args)).rows[0].id as string;
    await pg.query("insert into concierge.accounts (user_id, paid_features, over_budget_pct) values ($1, true, 20)", [userId]);
    const personId = await one(
      `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, 'Mom', 'mother', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
      [userId],
    );
    await pg.query(
      "insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at) values ($1, $2, 'interest', 'Tea', 'question', now() - interval '5 days')",
      [userId, personId],
    );
    const occasionId = await one("insert into concierge.occasions (user_id, person_id, kind, month, day) values ($1, $2, 'birthday', 3, 14) returning id", [userId, personId]);
    const roundId = await one(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + $4::int + 14, current_date + $4::int, 5000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [userId, personId, occasionId, o.deadlineIn ?? 30],
    );
    const ideaIds: string[] = [];
    for (const [i, title] of ["Mug set", "Herb planter"].entries()) {
      ideaIds.push(
        await one(
          `insert into concierge.gift_ideas (user_id, round_id, person_id, title, retailer, retailer_product_id, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank)
           values ($1, $2, $3, $4, 'amazon', $5, 'https://shop.test/p', 3000, 3500, 1, 2, $6, $7) returning id`,
          [userId, roundId, personId, title, `NN${roundId}${i}`, o.days ?? 4, i + 1],
        ),
      );
    }
    await runRow({ userId, personId, roundId }, "saved", "2 hours");
    await pg.query("insert into concierge.round_sends (round_id, user_id, step) values ($1, $2, 'heads_up')", [roundId, userId]);
    return { userId, email, personId, roundId, ideaIds };
  }

  const runRow = (r: { userId: string; personId: string; roundId: string }, outcome: string, ago: string) =>
    pg.query(
      `insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
       values ($1, $2, $3, now() - $4::interval, now() - $4::interval, $5)`,
      [r.userId, r.personId, r.roundId, ago, outcome],
    );

  /** Moves the round's runs well before whatever the test does next, whichever clock is ahead. */
  const runsEarlier = (r: Round) => pg.query("update concierge.idea_runs set started_at = started_at - interval '1 minute' where round_id = $1", [r.roundId]);

  const zincDeps = (fetcher?: typeof fetch): ZincDeps => ({
    db: client(fetcher),
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: async () => new Response("{}", { status: 500 }) },
    env: "test",
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
  });
  /** "None of these" through the real rejection code. */
  const reject = async (r: Round, o: Partial<Parameters<typeof rejectRoundIdeas>[0]> = {}, fetcher?: typeof fetch) => {
    expect(
      await rejectRoundIdeas({ userId: r.userId, roundId: r.roundId, code: "too_pricey", text: null, ownedIdeaId: null, expectMore: true, ...o }, zincDeps(fetcher)),
    ).toMatchObject({ ok: true, more: o.expectMore ?? true });
    // Due by the test process's clock too, which can be a little behind the database's.
    if (o.expectMore ?? true) await pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    // And well before the search it starts.
    await pg.query("update concierge.rejections set created_at = created_at - interval '1 minute' where round_id = $1", [r.roundId]);
  };

  /** A store that sees only this round and creates none, so the shared database's other rows are left alone. */
  function onlyOurs(store: RoundStore, roundId: string): RoundStore {
    return {
      ...store,
      candidates: async () => [],
      claimDue: async (now) => [await store.claim(roundId, now)].filter((r) => r !== null),
      claimDueMoney: async () => [],
      dueRounds: async () => [],
      roundsMissingOrderedEmail: async () => [],
      roundsWithRejectedAddresses: async () => [],
      deliveredRoundsUntold: async () => [],
    };
  }

  /** An idea run that ends as told: the real start and finish, with no AI or Zinc call between. */
  function engine(r: Round, outcome: IdeaOutcome["status"], o: { now?: Date; wrap?: (s: RoundStore) => RoundStore; fetcher?: typeof fetch; dies?: boolean } = {}) {
    const db = client(o.fetcher);
    const now = o.now ?? new Date();
    const generateIdeas = vi.fn(async (round: { id: string; userId: string; personId: string }): Promise<IdeaOutcome> => {
      const ideas = createSupabaseIdeaStore(db);
      const started = await ideas.start({ userId: round.userId, personId: round.personId, roundId: round.id }, now);
      if ("refused" in started) return { status: "refused", reason: started.refused };
      await ideas.finish(started.runId, outcome as "none", 0);
      if (o.dies) throw new Error("died");
      return { status: outcome } as IdeaOutcome;
    });
    const store = onlyOurs(createSupabaseRoundStore(db), r.roundId);
    const deps: EngineDeps = {
      store: o.wrap ? o.wrap(store) : store,
      notify: { store: createSupabaseNotifyStore(db), channels: [channel], baseUrl: "https://giftsaf.test", now },
      now,
      generateIdeas,
      zinc: null,
    };
    const sendJobs = async () => ({ sent: 0, failed: 0 });
    return {
      deps,
      generateIdeas,
      tick: () => runTick(deps),
      job: () => runRoundMessage({ kind: "round", roundId: r.roundId }, { ...deps, sendJobs }),
    };
  }

  const status = async (r: Round) => (await pg.query("select status::text as s from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].s;
  const ideas = async (r: Round) => (await pg.query("select status from concierge.gift_ideas where round_id = $1 order by rank", [r.roundId])).rows.map((x) => x.status);
  const steps = async (r: Round) => (await pg.query("select step from concierge.round_sends where round_id = $1 order by step", [r.roundId])).rows.map((x) => x.step);
  async function page(r: Round) {
    const db = createClient<Database>(local!.url, local!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await db.auth.signInWithPassword({ email: r.email, password });
    if (signedIn.error) throw signedIn.error;
    return (await roundView(r.roundId, db, new Date()))!;
  }

  // ─── the ideas come back ──────────────────────────────────────────────────

  it("AC-1, AC-20: in the run's own step the ideas come back with one heads-up, one event and the page's line", async () => {
    const r = await newRound();
    await reject(r);
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    const e = engine(r, "none");
    await e.tick();

    expect(e.generateIdeas).toHaveBeenCalledTimes(1);
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await status(r)).toBe("awaiting_approval");
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(mail[0].text).toContain(NOTHING_NEW);
    expect(await steps(r)).toEqual(["heads_up", "heads_up@1"]);
    const events = named("round.ideas_restored");
    expect(events).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: r.userId, count: 2, outcome: "none" })]);
    expect(Object.keys(events[0]).sort()).toEqual(["at", "count", "event", "outcome", "round_id", "user_id"]);
    expect((await page(r)).restored).toBe("none");
  });

  it.each(["failed", "cost_cap", "deadline"] as const)("AC-2: the last allowed run ended %s: the same, worded as ours", async (outcome) => {
    const r = await newRound();
    await reject(r);
    await engine(r, outcome).tick();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(mail[0].text).toContain(NOT_FINISHED);
    expect(mail[0].text).not.toContain(NOTHING_NEW);
    expect(named("round.ideas_restored")).toEqual([expect.objectContaining({ outcome })]);
    expect((await page(r)).restored).toBe("failed");
  });

  it("AC-1, AC-18: the queue's job does the same, and two jobs at once bring them back once with one email", async () => {
    await set("round_fanout_enabled", 1);
    const r = await newRound();
    await reject(r);
    const results = await Promise.all([engine(r, "none").job(), engine(r, "none").job()]);
    expect([...results].sort()).toEqual(["advanced", "busy"]);
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(mail).toHaveLength(1);
    expect(named("round.ideas_restored")).toHaveLength(1);
  });

  it.each(["none", "failed"] as const)("AC-3: the day before ship-by, after %s, they come back that day", async (outcome) => {
    const r = await newRound({ deadlineIn: 2 });
    await reject(r);
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = $1", [r.roundId]);
    if (outcome === "failed") await set("idea_round_runs_max", 3); // a run is left, but no tick to run it
    await engine(r, outcome).tick();
    expect(await status(r)).toBe("awaiting_approval");
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
  });

  it("AC-4, AC-16: the gift named in Already has one stays rejected, for an AI idea and for a list gift", async () => {
    for (const source of ["generated", "list"]) {
      const r = await newRound();
      if (source === "list") {
        const list = (await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id, share_token", [r.userId])).rows[0];
        const item = (await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Mug set', 3000) returning id", [list.id])).rows[0].id;
        await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [r.personId, r.userId, list.id, list.share_token]);
        await pg.query("update concierge.gift_ideas set source = 'list', list_item_id = $2 where id = $1", [r.ideaIds[0], item]);
      }
      await reject(r, { code: "has_it", ownedIdeaId: r.ideaIds[0] });
      expect((await pg.query("select idea_id from concierge.rejections where round_id = $1 and owned", [r.roundId])).rows).toEqual([{ idea_id: r.ideaIds[0] }]);
      await engine(r, "none").tick();
      expect(await ideas(r)).toEqual(["rejected", "proposed"]);
      expect(mail.at(-1)!.text).not.toContain("Mug set");
    }
  });

  it("AC-6: after two rejected sets only the latest comes back", async () => {
    await set("idea_round_runs_max", 3);
    const r = await newRound();
    await reject(r);
    await pg.query("update concierge.rejections set created_at = now() - interval '1 hour' where round_id = $1", [r.roundId]);
    const second = (
      await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank)
         values ($1, $2, $3, 'Scarf', 3000, 3500, 1, 2, 4, 3) returning id`,
        [r.userId, r.roundId, r.personId],
      )
    ).rows[0].id;
    await runRow(r, "saved", "1 minute");
    await pg.query("update concierge.gift_rounds set status = 'awaiting_approval' where id = $1", [r.roundId]);
    await reject(r);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected", "proposed"]);
    expect((await page(r)).ideas.find((i) => i.id === second)?.status).toBe("proposed");
    expect((await page(r)).restored).toBe("none");
  });

  it("AC-7: a budget set since marks each idea over it or not", async () => {
    const r = await newRound();
    await reject(r);
    await pg.query("update concierge.gift_rounds set budget_cents = 3400 where id = $1", [r.roundId]);
    await engine(r, "none").tick();
    expect(mail[0].text).toContain("Over budget");
  });

  // ─── nothing comes back ───────────────────────────────────────────────────

  it("AC-8: with nothing to bring back, the no-ideas email goes on the next tick, as today", async () => {
    const r = await newRound({ days: 60 });
    await reject(r);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(await status(r)).toBe("generating");
    expect(mail).toEqual([]);
    const next = engine(r, "none");
    await next.tick();
    expect(next.generateIdeas).not.toHaveBeenCalled();
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, we couldn't get gift ideas for Mom yet"]);
    expect(named("round.ideas_restored")).toEqual([]);
  });

  it("AC-19: switched off, the no-ideas email goes as today", async () => {
    await set("restore_rejected_ideas_enabled", 0);
    const r = await newRound();
    await reject(r);
    await engine(r, "none").tick();
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, we couldn't get gift ideas for Mom yet"]);
  });

  it("AC-9: after no_credit nothing comes back, even the day before ship-by", async () => {
    const r = await newRound({ deadlineIn: 2 });
    await reject(r);
    await runRow(r, "failed", "1 minute");
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = $1", [r.roundId]);
    await set("idea_round_runs_max", 5);
    await engine(r, "no_credit").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(mail).toEqual([]);
  });

  it("AC-9, AC-13: after failed with a run left, nothing comes back and the next tick retries", async () => {
    await set("idea_round_runs_max", 3);
    const r = await newRound();
    await reject(r);
    await engine(r, "failed").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    const next = engine(r, "none");
    await next.tick();
    expect(next.generateIdeas).toHaveBeenCalledTimes(1);
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(mail[0].text).toContain(NOTHING_NEW);
  });

  it("AC-9: a round that was never rejected gets the no-ideas email", async () => {
    const r = await newRound();
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.idea_runs where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    await engine(r, "none").tick();
    await engine(r, "none").tick();
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, we couldn't get gift ideas for Mom yet"]);
    expect(named("round.ideas_restored")).toEqual([]);
  });

  // ─── no second bill ───────────────────────────────────────────────────────

  it("AC-11, AC-12: after a run that found nothing none starts, until a new fact allows one", async () => {
    await set("idea_round_runs_max", 3);
    const r = await newRound();
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.idea_runs where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    await engine(r, "none").tick();
    const second = engine(r, "none");
    await second.tick();
    expect(second.generateIdeas).not.toHaveBeenCalled();
    // The store's own door refuses it too, whoever asks.
    expect(await createSupabaseIdeaStore(client()).start({ userId: r.userId, personId: r.personId, roundId: r.roundId }, new Date())).toEqual({ refused: "limit" });

    await runsEarlier(r);
    await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'Pottery', 'question')", [r.userId, r.personId]);
    // The fact woke the round, at the database's clock.
    expect((await pg.query("select next_action_at <= now() as due from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].due).toBe(true);
    await pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    const third = engine(r, "none");
    await third.tick();
    expect(third.generateIdeas).toHaveBeenCalledTimes(1);
    expect((await pg.query("select outcome from concierge.idea_runs where round_id = $1", [r.roundId])).rows).toEqual([{ outcome: "none" }, { outcome: "none" }]);
  });

  // ─── too late ─────────────────────────────────────────────────────────────

  /** A rejected round, the day before its ship-by day, with runs to spare and nothing that could come back. */
  async function lastDay(): Promise<Round> {
    const r = await newRound({ deadlineIn: 2, days: 60 });
    await reject(r);
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = $1", [r.roundId]);
    await set("idea_round_runs_max", 5);
    return r;
  }
  const runs = async (r: Round) => Number((await pg.query("select count(*) as n from concierge.idea_runs where round_id = $1", [r.roundId])).rows[0].n);

  it.each([
    ["none", "tick"],
    ["none", "job"],
    ["failed", "tick"],
    ["failed", "job"],
  ] as const)("AC-10: the day before ship-by, after %s with nothing to bring back, the too-late email goes that day; a duplicate %s adds no run and no email", async (outcome, how) => {
    if (how === "job") await set("round_fanout_enabled", 1);
    const r = await lastDay();
    await engine(r, outcome)[how]();
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, no gift can arrive in time for Mom"]);
    expect(mail[0].text).not.toContain("Tell us more");
    expect(await steps(r)).toEqual(["heads_up@1", "no_ideas_late"]);
    expect(await status(r)).toBe("generating");
    // Not due again until the ship-by day.
    const due = await pg.query("select next_action_at = (ship_by_deadline::timestamp at time zone 'utc') as at_deadline from concierge.gift_rounds where id = $1", [r.roundId]);
    expect(due.rows[0].at_deadline).toBe(true);
    expect(await runs(r)).toBe(2);

    const again = engine(r, "none");
    await again[how]();
    // Even made due, by hand or by a new fact.
    await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'Pottery', 'question')", [r.userId, r.personId]);
    await pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    await again[how]();
    expect(again.generateIdeas).not.toHaveBeenCalled();
    expect(await runs(r)).toBe(2);
    expect(mail).toHaveLength(1);
  });

  it("AC-10: a round told too late while the idea pass takes its turn gets no run", async () => {
    const r = await lastDay();
    // It's scheduled, so the pass lets go of the lease and takes it again; another run tells the buyer in between.
    await pg.query("update concierge.gift_rounds set status = 'scheduled' where id = $1", [r.roundId]);
    const e = engine(r, "none", {
      wrap: (store) => ({
        ...store,
        finish: async (id, lock, next) => {
          const ok = await store.finish(id, lock, next);
          await pg.query("insert into concierge.round_sends (round_id, user_id, step) values ($1, $2, 'no_ideas_late') on conflict do nothing", [r.roundId, r.userId]);
          return ok;
        },
      }),
    });
    await e.tick();
    expect(e.generateIdeas).not.toHaveBeenCalled();
    expect(mail).toEqual([]);
  });

  /** A round that was never emailed and never had an idea, the day before its ship-by day, with runs to spare. */
  async function neverTold(): Promise<Round> {
    const r = await newRound({ deadlineIn: 1 });
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.idea_runs where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.round_sends where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    await set("idea_round_runs_max", 5);
    return r;
  }

  it.each(["none", "failed"] as const)("AC-10: a refused too-late email after %s: no second run that day, and the close sends the one email", async (outcome) => {
    const r = await neverTold();
    refuse = true;
    const first = engine(r, outcome);
    await first.tick();
    expect(await status(r)).toBe("generating");
    refuse = false;
    // A duplicate tick, even after a new fact, or once the lease is over.
    await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', 'Pottery', 'question')", [r.userId, r.personId]);
    await pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute', locked_until = null where id = $1", [r.roundId]);
    const again = engine(r, outcome);
    await again.tick();
    expect(again.generateIdeas).not.toHaveBeenCalled();
    expect(await runs(r)).toBe(1);
    expect(mail).toEqual([]);
    await engine(r, outcome, { now: closeDay() }).tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toHaveLength(1);
    expect(await steps(r)).toContain("skipped");
  });

  it("AC-10: a round that ran and was never told anything is told at its close, not skipped in silence", async () => {
    const r = await neverTold();
    await runRow(r, "failed", "1 day");
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date where id = $1", [r.roundId]);
    await engine(r, "none").tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toHaveLength(1);
    expect(named("round_skipped_silently")).toEqual([]);
  });

  it("a round that never ran, or whose buyer isn't paid, still ends in silence", async () => {
    for (const paid of [true, false]) {
      const r = await neverTold();
      if (!paid) {
        await runRow(r, "failed", "1 day");
        await pg.query("update concierge.accounts set paid_features = false where user_id = $1", [r.userId]);
      }
      await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date where id = $1", [r.roundId]);
      await engine(r, "none").tick();
      expect(await status(r)).toBe("skipped");
    }
    expect(mail).toEqual([]);
  });

  it("AC-10: a death between recording the too-late email and sending it: the close says it instead", async () => {
    const r = await neverTold();
    await engine(r, "none", {
      wrap: (store) => ({
        ...store,
        recordSend: async (...a) => {
          await store.recordSend(...a);
          throw new Error("died");
        },
      }),
    }).tick();
    expect(await steps(r)).toEqual(["no_ideas_late"]);
    expect(mail).toEqual([]);
    await pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await engine(r, "none", { now: closeDay() }).tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toHaveLength(1);
  });

  it("AC-10: an earlier no-ideas email doesn't stand in for a too-late one that never went", async () => {
    const r = await neverTold();
    await pg.query(
      "insert into concierge.notifications (user_id, round_id, kind, channel, sent_at, created_at) values ($1, $2, 'no_ideas', 'email', now() - interval '5 days', now() - interval '5 days')",
      [r.userId, r.roundId],
    );
    await pg.query("insert into concierge.round_sends (round_id, user_id, step) values ($1, $2, 'no_ideas_late')", [r.roundId, r.userId]);
    await engine(r, "none", { now: closeDay() }).tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toHaveLength(1);
  });

  const closeDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  it("AC-10: told too late, the close the next day sends nothing more and is logged as skipped", async () => {
    const r = await lastDay();
    await engine(r, "none").tick();
    mail = [];
    await engine(r, "none", { now: closeDay() }).tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toEqual([]);
    expect(await steps(r)).toEqual(["heads_up@1", "no_ideas_late"]);
    expect(named("round_skipped_silently")).toEqual([]);
    expect(named("round_step")).toContainEqual(expect.objectContaining({ round_id: r.roundId, next_status: "skipped" }));
  });

  it("an ordinary skip is still emailed: told there were no ideas before, or only asked", async () => {
    const r = await newRound({ days: 60 });
    await reject(r);
    await engine(r, "none").tick();
    await engine(r, "none").tick();
    expect(await steps(r)).toEqual(["heads_up@1", "no_ideas"]);
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date, next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    mail = [];
    await engine(r, "none").tick();
    expect(await status(r)).toBe("skipped");
    expect(mail).toHaveLength(1);
    expect(await steps(r)).toContain("skipped");
  });

  it("AC-12: three runs, two facts: the second email doesn't promise to skip, since a third run follows, and no third email goes", async () => {
    const r = await newRound();
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.idea_runs where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    const sinceFact = async (value: string) => {
      await pg.query("update concierge.idea_runs set started_at = started_at - interval '1 minute' where round_id = $1", [r.roundId]);
      await pg.query("update concierge.round_sends set created_at = created_at - interval '1 minute' where round_id = $1", [r.roundId]);
      await pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', $3, 'question')", [r.userId, r.personId, value]);
      await pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
      // After the fact, whichever clock is ahead.
      const e = engine(r, "none", { now: new Date(Date.now() + 1000) });
      await e.tick();
      expect(e.generateIdeas).toHaveBeenCalledTimes(1);
      await engine(r, "none", { now: new Date(Date.now() + 2000) }).tick();
    };
    await engine(r, "none").tick();
    await engine(r, "none").tick();
    await sinceFact("Pottery");
    await sinceFact("Jazz");
    expect(await runs(r)).toBe(3);
    expect(await steps(r)).toEqual(["heads_up", "no_ideas", "no_ideas_again"]);
    expect(mail).toHaveLength(2);
    expect(mail[1].text).toContain("Unless you tell us something new and we find a gift, we'll skip this occasion.");
  });

  // ─── a death or a refused send in between ─────────────────────────────────

  it("AC-17: a refused heads-up is sent by the next tick, worded the same, with no run", async () => {
    const r = await newRound();
    await reject(r);
    refuse = true;
    await engine(r, "failed").tick();
    expect(await status(r)).toBe("generating");
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    refuse = false;
    // The refused step kept its lease; it lapses before the next tick.
    await pg.query("update concierge.gift_rounds set locked_until = now() - interval '1 second' where id = $1", [r.roundId]);
    const next = engine(r, "none");
    await next.tick();
    expect(next.generateIdeas).not.toHaveBeenCalled();
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(mail[0].text).toContain(NOT_FINISHED);
    expect(await status(r)).toBe("awaiting_approval");
    expect(named("round.ideas_restored")).toHaveLength(1);
  });

  it("AC-17: the job path sends it too", async () => {
    await set("round_fanout_enabled", 1);
    const r = await newRound();
    await reject(r);
    refuse = true;
    await engine(r, "none").job();
    refuse = false;
    await pg.query("update concierge.gift_rounds set locked_until = now() - interval '1 second' where id = $1", [r.roundId]);
    const next = engine(r, "none");
    expect(await next.job()).toBe("advanced");
    expect(next.generateIdeas).not.toHaveBeenCalled();
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
  });

  it("AC-1: a process that dies between the run and the ideas coming back: the next tick brings them back, not the no-ideas email", async () => {
    const r = await newRound();
    await reject(r);
    await engine(r, "none", { dies: true }).tick();
    expect(mail).toEqual([]);
    await pg.query("update concierge.gift_rounds set locked_until = now() - interval '1 second' where id = $1", [r.roundId]);
    const next = engine(r, "none");
    await next.tick();
    expect(next.generateIdeas).not.toHaveBeenCalled();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
  });

  it("AC-17: a death between the ideas coming back and their email: the next tick sends it, with no run", async () => {
    const r = await newRound();
    await reject(r);
    await engine(r, "none", {
      wrap: (store) => ({
        ...store,
        recordSend: async () => {
          throw new Error("died");
        },
      }),
    }).tick();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await status(r)).toBe("generating");
    expect(mail).toEqual([]);
    await pg.query("update concierge.gift_rounds set locked_until = now() - interval '1 second' where id = $1", [r.roundId]);
    const next = engine(r, "none");
    await next.tick();
    expect(next.generateIdeas).not.toHaveBeenCalled();
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(mail[0].text).toContain(NOTHING_NEW);
    expect(named("round.ideas_restored")).toHaveLength(1);
  });

  it("AC-18: two ticks at once bring them back once, with one email", async () => {
    const r = await newRound();
    await reject(r);
    await Promise.all([engine(r, "none").tick(), engine(r, "none").tick()]);
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await runs(r)).toBe(2);
    expect(mail).toHaveLength(1);
    expect(named("round.ideas_restored")).toHaveLength(1);
  });

  it("AC-2: the function was killed during the last run: the next tick brings them back, worded as ours", async () => {
    const r = await newRound();
    await reject(r);
    await pg.query("insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values ($1, $2, $3, now() - interval '30 seconds')", [r.userId, r.personId, r.roundId]);
    await set("idea_run_lease_ms", 1000);
    const e = engine(r, "none");
    await e.tick();
    expect(e.generateIdeas).not.toHaveBeenCalled();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(mail[0].text).toContain(NOT_FINISHED);
    expect(named("round.ideas_restored")).toEqual([expect.objectContaining({ outcome: "failed" })]);
  });

  it("AC-9: a date moved during the run ends the round: nothing comes back, nothing is sent, and no failure is logged", async () => {
    await set("moved_dates_close_rounds", 1);
    const r = await newRound();
    await reject(r);
    const e = engine(r, "none", {
      wrap: (store) => ({
        ...store,
        restoreRejected: async (...a) => {
          await pg.query("update concierge.occasions set day = 20 where person_id = $1", [r.personId]);
          return store.restoreRejected(...a);
        },
      }),
    });
    await e.tick();
    expect(await status(r)).toBe("skipped");
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(mail).toEqual([]);
    expect(named("round_ended_by_move")).toEqual([expect.objectContaining({ round_id: r.roundId })]);
    for (const name of ["round_failed", "round.ideas_restore_failed", "round.ideas_restored"]) expect(named(name)).toEqual([]);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
  });

  // ─── a round already told, and waiting ────────────────────────────────────

  /** Told there were no ideas, with the rejected ones never brought back, and not due until its deadline. */
  async function toldAndWaiting(o: { days?: number } = {}): Promise<Round> {
    const r = await newRound(o);
    await reject(r);
    await set("restore_rejected_ideas_enabled", 0);
    await engine(r, "none").tick();
    await engine(r, "none").tick();
    await set("restore_rejected_ideas_enabled", 1);
    expect(await steps(r)).toEqual(["heads_up@1", "no_ideas"]);
    mail = [];
    return r;
  }
  const wake = (r: Round) => pg.query("update concierge.gift_rounds set next_action_at = now() - interval '1 minute', locked_until = null where id = $1", [r.roundId]);

  it("AC-1: a round told before this shipped gets its ideas back once it's woken, with one email", async () => {
    const r = await toldAndWaiting();
    await wake(r);
    const e = engine(r, "none");
    await e.tick();
    expect(e.generateIdeas).not.toHaveBeenCalled();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await status(r)).toBe("awaiting_approval");
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    await wake(r);
    await engine(r, "none").tick();
    expect(mail).toHaveLength(1);
    expect(named("round.ideas_restored")).toHaveLength(1);
  });

  it("AC-2: told before, then killed in its last run: the ideas come back", async () => {
    const r = await toldAndWaiting();
    await runsEarlier(r);
    await pg.query("insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values ($1, $2, $3, now() - interval '30 seconds')", [r.userId, r.personId, r.roundId]);
    // Told again too, so the plan only waits.
    await pg.query("insert into concierge.round_sends (round_id, user_id, step) values ($1, $2, 'no_ideas_again')", [r.roundId, r.userId]);
    await set("idea_run_lease_ms", 1000);
    await wake(r);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(mail[0].text).toContain(NOT_FINISHED);
  });

  it("a round waiting to its deadline isn't looked at on other days, and a look that brings nothing back sends nothing", async () => {
    const r = await toldAndWaiting({ days: 60 });
    const w = watched();
    for (let i = 0; i < 3; i++) await engine(r, "none", { fetcher: w.fetcher }).tick();
    expect(w.count("restore_rejected_ideas")).toBe(0);
    expect(w.count("round_idea_state")).toBe(0);
    for (let i = 1; i <= 3; i++) {
      await wake(r);
      await engine(r, "none", { fetcher: w.fetcher }).tick();
      expect(w.count("restore_rejected_ideas")).toBe(i);
      // Back to its deadline each time, not due again.
      const due = await pg.query("select next_action_at = (ship_by_deadline::timestamp at time zone 'utc') as at_deadline from concierge.gift_rounds where id = $1", [r.roundId]);
      expect(due.rows[0].at_deadline).toBe(true);
    }
    expect(mail).toEqual([]);
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
  });

  it("a round told it's too late gets nothing back after that", async () => {
    const r = await lastDay();
    await engine(r, "none").tick();
    mail = [];
    await pg.query("update concierge.gift_ideas set delivery_days_max = 1 where round_id = $1", [r.roundId]);
    await wake(r);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(mail).toEqual([]);
  });

  // ─── no promise of a run that can't happen ────────────────────────────────

  it("rejected twice with every run spent, the no-ideas email doesn't promise another try", async () => {
    const r = await newRound({ days: 60 });
    await reject(r);
    await pg.query(
      `insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank)
       values ($1, $2, $3, 'Scarf', 3000, 3500, 1, 2, 60, 3)`,
      [r.userId, r.roundId, r.personId],
    );
    await runRow(r, "saved", "30 seconds");
    await pg.query("update concierge.gift_rounds set status = 'awaiting_approval' where id = $1", [r.roundId]);
    await reject(r, { code: "not_style", text: "Nothing woollen" });
    await runsEarlier(r);
    await engine(r, "none", { now: new Date(Date.now() + 1000) }).tick();
    expect(await runs(r)).toBe(3);
    await engine(r, "none", { now: new Date(Date.now() + 2000) }).tick();
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, we couldn't get gift ideas for Mom yet"]);
    expect(mail[0].text).not.toMatch(/try once more|unless you tell us/i);
    expect(mail[0].text).toContain("we'll skip this occasion");
  });

  it("the second email, after the extra run, doesn't promise one either", async () => {
    await set("idea_round_runs_max", 1);
    const r = await newRound();
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
    await pg.query("delete from concierge.idea_runs where round_id = $1", [r.roundId]);
    await pg.query("insert into concierge.round_sends (round_id, user_id, step, created_at) values ($1, $2, 'no_ideas', now() - interval '1 hour')", [r.roundId, r.userId]);
    await runRow(r, "none", "2 hours");
    await runRow(r, "none", "1 minute");
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [r.roundId]);
    await engine(r, "none").tick();
    expect(mail[0].text).toContain("We tried again");
    expect(mail[0].text).not.toMatch(/try once more|unless you tell us/i);
  });

  // ─── a database, or a round, the restore isn't for ────────────────────────

  it("the restore isn't called when it's switched off, or for a round nothing was rejected in", async () => {
    const off = await newRound();
    await reject(off);
    await set("restore_rejected_ideas_enabled", 0);
    const w = watched();
    await engine(off, "none", { fetcher: w.fetcher }).tick();
    await set("restore_rejected_ideas_enabled", 1);
    const never = await newRound();
    await pg.query("delete from concierge.gift_ideas where round_id = $1", [never.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'generating', next_action_at = now() - interval '1 minute' where id = $1", [never.roundId]);
    await engine(never, "none", { fetcher: w.fetcher }).tick();
    expect(w.count("restore_rejected_ideas")).toBe(0);
    expect(named("round.ideas_restore_failed")).toEqual([]);
  });

  it.each([
    ["missing", noSuchFunction],
    ["failing", () => new Response(JSON.stringify({ code: "XX000", message: "secret Mom" }), { status: 500, headers: { "content-type": "application/json" } })],
  ] as const)("a %s restore function is logged, ids only, and the no-ideas email still goes", async (_, answer) => {
    const r = await newRound();
    await reject(r);
    const w = watched({ restore_rejected_ideas: answer });
    await engine(r, "none", { fetcher: w.fetcher }).tick();
    await engine(r, "none", { fetcher: w.fetcher }).tick();
    expect(w.count("restore_rejected_ideas")).toBe(2);
    expect(mail.map((m) => m.subject)).toEqual(["Sorry, we couldn't get gift ideas for Mom yet"]);
    const logged = named("round.ideas_restore_failed");
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ round_id: r.roundId, user_id: r.userId, alert: true });
    expect(JSON.stringify(logged)).not.toContain("Mom");
  });

  it("a restore that worked but whose answer was lost still sends the heads-up", async () => {
    const r = await newRound();
    await reject(r);
    await engine(r, "none", {
      wrap: (store) => ({
        ...store,
        restoreRejected: async (...a) => {
          await store.restoreRejected(...a);
          throw new Error("the answer was lost");
        },
      }),
    }).tick();
    expect(mail.map((m) => m.subject)).toEqual(["Mom's birthday: your earlier ideas are still here"]);
    expect(await status(r)).toBe("awaiting_approval");
  });

  it("None of these with a named gift works on a database without the new argument", async () => {
    const r = await newRound();
    const w = watched({ reject_round_ideas: (init) => (String(init?.body).includes("p_owned_idea_id") ? noSuchFunction() : null) });
    await reject(r, { code: "has_it", ownedIdeaId: r.ideaIds[0] }, w.fetcher);
    expect(w.count("reject_round_ideas")).toBe(2);
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    const plain = await newRound();
    const p = watched();
    await reject(plain, {}, p.fetcher);
    expect(p.calls.filter((c) => c.fn === "reject_round_ideas").map((c) => "p_owned_idea_id" in c.body)).toEqual([false]);
  });

  it("AC-18: a run that lost its lease brings nothing back and sends nothing", async () => {
    const r = await newRound();
    await reject(r);
    await engine(r, "none", {
      wrap: (store) => ({
        ...store,
        restoreRejected: async (id, lock, now) => {
          await pg.query("update concierge.gift_rounds set locked_until = now() + interval '20 minutes' where id = $1", [id]);
          return store.restoreRejected(id, lock, now);
        },
      }),
    }).tick();
    expect(await ideas(r)).toEqual(["rejected", "rejected"]);
    expect(mail).toEqual([]);
  });

  // ─── after they came back ─────────────────────────────────────────────────

  async function restored(): Promise<Round> {
    const r = await newRound();
    await reject(r);
    await engine(r, "none").tick();
    await runsEarlier(r);
    mail = [];
    return r;
  }

  it("AC-15: None of these again with no search left keeps them buyable", async () => {
    const r = await restored();
    const input = { roundId: r.roundId, code: "too_pricey" as const, text: null, ownedIdeaId: null };
    expect(await rejectionOutlook(input, zincDeps())).toMatchObject({ more: false });
    await reject(r, { expectMore: false });
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await status(r)).toBe("awaiting_approval");
    expect((await page(r)).restored).toBe("none");
  });

  it("AC-11, AC-15: None of these again for the same reason says there's no new search, and pays for none", async () => {
    const r = await newRound();
    const same = { code: "not_style" as const, text: "Nothing plastic" };
    await reject(r, same);
    // The search starts after the facts were saved, whichever clock is ahead.
    await engine(r, "none", { now: new Date(Date.now() + 1000) }).tick();
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await rejectionOutlook({ roundId: r.roundId, ...same, ownedIdeaId: null }, zincDeps())).toMatchObject({ more: false });
    // What an old sheet would send is refused once, not in a loop.
    const send = (expectMore: boolean) => rejectRoundIdeas({ userId: r.userId, roundId: r.roundId, ...same, ownedIdeaId: null, expectMore }, zincDeps());
    expect(await send(true)).toEqual({ ok: false, error: "changed" });
    expect(await send(false)).toMatchObject({ ok: true, more: false });
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await status(r)).toBe("awaiting_approval");
    // Saving it did touch the fact; that still earns nothing, even well after the search.
    await pg.query("update concierge.profile_facts set updated_at = now() where person_id = $1", [r.personId]);
    expect(await rejectionOutlook({ roundId: r.roundId, code: "too_pricey", text: null, ownedIdeaId: null }, zincDeps())).toMatchObject({ more: false });
    expect(await runs(r)).toBe(2);
  });

  it("AC-15: ... and with a new fact and a run left the sheet says so and the search runs", async () => {
    const r = await restored();
    const input = { roundId: r.roundId, code: "not_style" as const, text: "Nothing plastic", ownedIdeaId: null };
    expect(await rejectionOutlook(input, zincDeps())).toMatchObject({ more: true });
    await reject(r, { code: "not_style", text: "Nothing plastic" });
    const e = engine(r, "none");
    await e.tick();
    expect(e.generateIdeas).toHaveBeenCalledTimes(1);
    expect(await e.generateIdeas.mock.results[0].value).toEqual({ status: "none" });
    expect(await ideas(r)).toEqual(["proposed", "proposed"]);
    expect(await steps(r)).toEqual(["heads_up", "heads_up@1", "heads_up@2"]);
    expect(mail).toHaveLength(1);
  });

  it("AC-4, AC-20: a list gift noted as one they have gets no false line, and never comes back with the rest", async () => {
    const r = await newRound();
    const list = (await pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id, share_token", [r.userId])).rows[0];
    const item = (await pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Mug set', 3000) returning id", [list.id])).rows[0].id;
    await pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [r.personId, r.userId, list.id, list.share_token]);
    await pg.query("update concierge.gift_ideas set source = 'list', list_item_id = $2 where id = $1", [r.ideaIds[0], item]);
    // No search left: only noted, and both ideas stay on offer.
    await set("idea_round_runs_max", 1);
    await reject(r, { code: "has_it", ownedIdeaId: r.ideaIds[0], expectMore: false });
    expect((await page(r)).restored).toBeNull();
    // A search later, which finds nothing: only the other one comes back.
    await set("idea_round_runs_max", 2);
    await reject(r);
    await engine(r, "none").tick();
    expect(await ideas(r)).toEqual(["rejected", "proposed"]);
    expect((await page(r)).restored).toBe("none");
  });

  it("AC-20: the page shows no line for a round whose ideas never left", async () => {
    const r = await newRound();
    expect((await page(r)).restored).toBeNull();
    await reject(r, { code: "too_pricey" });
    expect((await page(r)).restored).toBeNull();
  });
});
