import { describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";
import type { IdeaOutcome } from "../ideas/run";
import { advanceRound, runTick } from "../rounds/engine";
import { retryOrderedEmails } from "../rounds/money-path";
import { heldRounds, type User } from "./round-engine-held";
import { BASE, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Held rounds: every failure told once, due rounds, and idea runs beside the money path.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("held rounds: failures and due rounds (real local database, fake Zinc)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, engine, advance, approve, newUser, newRound, roundRow, sends, inbox, textFor } = held;

  // ─── ALL-116: every failure is told, once, with the right gift and reason ───

  /** A round whose picks are all placing, ids in rank order. (A Zinc timeout stops the run, so only
   *  the first would really be placing: the rest are moved there directly, as a later run would.) */
  async function placingRound(u: User, totals = [4200, 3000]) {
    const r = await newRound(u, { totals });
    for (const id of r.ideaIds) held.zinc.plan.set(`https://shop.test/p/${id}`, ["timeout"]);
    await approve(u, r);
    await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where round_id = $1 and status = 'held'", [r.roundId]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    const rows = await held.pg.query(
      "select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank",
      [r.roundId],
    );
    return { ...r, orderIds: rows.rows.map((x) => x.id as string) };
  }
  const settleFailed = (u: User, orderId: string, type: string) =>
    held.pg.query("select concierge.settle_order($1, $2, 'failed', $3, null)", [u.userId, orderId, type]);
  const lastText = (u: User) => mail.filter((m) => m.to === u.email).at(-1)!.text;

  it("two failures before one email: one summary names both, each with its reason (AC-1)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    await settleFailed(u, r.orderIds[0], "price_up");
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 1);
    expect(inbox(u).slice(before)).toEqual(["Sorry, 2 of Mary's Christmas gifts couldn't be bought@1"]);
    const text = lastText(u);
    expect(text).toContain("and neither of them went through.");
    expect(text).toContain("- Stoneware mug set (The price went up more than you allowed for. Approve the new price, or choose another gift.)");
    expect(text).toContain("- Linen apron (The store ran out. Choose another gift.)");
    expect(text).toContain("Review the new price for the Stoneware mug set:");
    // Each gift links to its own fix page (ALL-29 AC-16).
    expect(text).toContain(`Review the new price for the Stoneware mug set: ${BASE}/rounds/${r.roundId}/fix/${r.orderIds[0]}`);
    expect(text).toContain(`Choose another gift instead of the Linen apron: ${BASE}/rounds/${r.roundId}/fix/${r.orderIds[1]}`);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(r.orderIds.map((id) => `fail:${id}`)));
    // The price failure can still be re-approved.
    const priceUp = await held.pg.query("select status, failure_type, resolved from concierge.orders where id = $1", [r.orderIds[0]]);
    expect(priceUp.rows[0]).toEqual({ status: "failed", failure_type: "price_up", resolved: false });
    // Told once.
    await held.pg.query("update concierge.gift_rounds set next_action_at = now() where id = $1", [r.roundId]);
    await advance(r.roundId, 2);
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("a single failure's button opens that order's fix page (ALL-29 AC-16)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "price_up");
    await advance(r.roundId, 1);
    expect(inbox(u)).toHaveLength(1);
    expect(lastText(u)).toContain(`Review the gift: ${BASE}/rounds/${r.roundId}/fix/${r.orderIds[0]}`);
  });

  it.each(["address_withdrawn", "address_rejected", "failed"])(
    "a single %s failure's button opens that order's fix page (ALL-29 AC-16)",
    async (type) => {
      const u = await newUser({ autoTopUp: null });
      const r = await placingRound(u, [4200]);
      await settleFailed(u, r.orderIds[0], type);
      await advance(r.roundId, 1);
      expect(inbox(u)).toEqual(["Sorry, there's a problem with Mary's gift@1"]);
      expect(lastText(u)).toContain(`Review the gift: ${BASE}/rounds/${r.roundId}/fix/${r.orderIds[0]}`);
    },
  );

  it.each(["out_of_stock", "price_up", "too_late", "failed"])("a %s failure's email names the gift of the same round that was ordered", async (type) => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    await settleFailed(u, r.orderIds[0], type);
    await advance(r.roundId, 1);
    // Still placing: being ordered, not yet "on its way".
    expect(lastText(u)).toContain("The good news: we're ordering the Linen apron, and we'll email you as soon as the store confirms it.");

    const p = await placingRound(u);
    await held.pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, p.orderIds[1]]);
    await settleFailed(u, p.orderIds[0], type);
    await advance(p.roundId, 1);
    expect(lastText(u)).toContain("The good news: the Linen apron is ordered and on its way.");
    // Only for the one that failed: the ordered one is charged.
    expect(lastText(u)).toContain("you haven't been charged for it.");

    // One delivered already isn't still "on its way".
    const d = await placingRound(u);
    await held.pg.query("update concierge.orders set status = 'delivered', delivered_at = now() where id = $1", [d.orderIds[1]]);
    await settleFailed(u, d.orderIds[0], type);
    await advance(d.roundId, 1);
    expect(lastText(u)).not.toContain("good news");
  });

  it("the summary of two failures names a third gift still being ordered", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200, 3000, 2500]);
    await settleFailed(u, r.orderIds[0], "price_up");
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    await advance(r.roundId, 1);
    expect(lastText(u)).toContain("2 of them didn't go through.");
    expect(lastText(u)).toContain("The good news: we're ordering the ");
  });

  it("a failure next to a held gift doesn't call the held one ordered", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, [{ status: 400, code: "out_of_stock" }]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const text = mail.filter((m) => m.to === u.email).find((m) => m.subject.includes("out of stock"))!.text;
    expect(text).not.toContain("good news");
  });

  it("a later failure is told on its own, and the gift named is the one that failed (AC-2, AC-3)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    // The one created second fails first...
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    await advance(r.roundId, 1);
    expect(lastText(u)).toContain("The store ran out of the Linen apron");
    // ...and the one created first fails last.
    await settleFailed(u, r.orderIds[0], "too_late");
    await advance(r.roundId, 2);
    expect(inbox(u).slice(-2)).toEqual(["Sorry, Mary's gift is out of stock@1", "Sorry, Mary's gift can't arrive in time@2"]);
    expect(lastText(u)).toContain("The Stoneware mug set wouldn't arrive in time");
    expect(lastText(u)).not.toContain("Linen apron");
  });

  it("a failure next to an unconfirmed order is told, not hidden behind 'still confirming' (AC-4)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u);
    await held.pg.query("select concierge.mark_unconfirmed($1)", [r.orderIds[0]]);
    await advance(r.roundId, 1);
    await settleFailed(u, r.orderIds[1], "out_of_stock");
    await advance(r.roundId, 2);
    expect(inbox(u)).toContain("Sorry, Mary's gift is out of stock@2");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
  });

  it("a failure on the ship-by day with nothing else: 'We couldn't buy it' with the reason, not 'No gift' (AC-7)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy Mary's gift@30"]);
    expect(lastText(u)).toContain("The store ran out. You haven't been charged for it.");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(await sends(r.roundId)).not.toContain("skipped");
  });

  it("on the ship-by day, an untold failure and a held gift: one email names both (owner, AC-5)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (
      await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])
    ).rows;
    await settleFailed(u, first.id, "out_of_stock");
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy 2 of Mary's Christmas gifts@30"]);
    const text = lastText(u);
    expect(text).toContain("- Stoneware mug set (The store ran out.)");
    expect(text).toContain("- Linen apron (It couldn't be bought in time, so we cancelled it.)");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
  });

  it("a refused failure email is logged for the owner, still lets the run go on, and goes on the next look (AC-11)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const log = vi.spyOn(console, "log");
    held.refuse = true;
    expect(await advance(r.roundId, 1)).toBe("advanced");
    held.refuse = false;
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_failure_email_failed");
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
    expect(await sends(r.roundId)).not.toContain(`fail:${r.orderIds[0]}`);
    await advance(r.roundId, 2);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@2"]);
  });

  it("closed early with a failure untold (the cancel link): the late email tells it and says it stopped early (AC-5, AC-13)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "price_up");
    await held.pg.query("select concierge.cancel_held($1, 'cancel')", [r.roundId]);
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u)).toEqual(["We're sorry, we couldn't buy Mary's gift@1"]);
    expect(lastText(u)).toContain("The price went up more than you allowed for. You haven't been charged for it.");
    expect(lastText(u)).toContain("this occasion's gifts were stopped early");
    expect(lastText(u)).toContain("Open Mary's page:");
  });

  it("a removed person with a failure untold: still told, and the button doesn't open their page (owner)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const person = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].person_id;
    await held.pg.query("update public.people set deleted_at = now() where id = $1", [person]);
    await held.pg.query("select concierge.skip_open_rounds($1, null)", [person]);
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u)).toEqual(["We're sorry, we couldn't buy Mary's gift@1"]);
    expect(lastText(u)).toContain("Open GiftsAF:");
    expect(lastText(u)).not.toContain("Open Mary's page");
  });

  it("approving into one failure and one funds hold: both told at once, and the result says failed (AC-14, review S1)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, [{ status: 400, code: "out_of_stock" }]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    const result = await approve(u, r);
    expect(result).toMatchObject({ ok: true, status: "failed" });
    // The held gift decides the reason, so it's still emailed and placed when funds arrive.
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
    expect(inbox(u).sort()).toEqual(["Sorry, Mary's gift is out of stock@0", "Sorry, Mary's gift is waiting on your Zinc balance@0"].sort());
    expect(await held.pg.query("select 1 from concierge.held_rounds_for_user($1) where id = $2", [u.userId, r.roundId])).toMatchObject({ rowCount: 1 });
  });

  it("an error after claiming gives the failures back, so the next look still tells them (review B2)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placingRound(u, [4200]);
    await settleFailed(u, r.orderIds[0], "out_of_stock");
    const deps = engine(dayAt(1));
    const real = deps.notify.store;
    deps.notify = {
      ...deps.notify,
      store: {
        ...real,
        insertNotification: async () => {
          throw new Error("database blip");
        },
      },
    };
    await advanceRound(r.roundId, deps);
    expect(await sends(r.roundId)).not.toContain(`fail:${r.orderIds[0]}`);
    await advance(r.roundId, 2);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@2"]);
  });


  // ─── ALL-125: dueRounds reads what claimDue would take, and takes nothing ─

  it("dueRounds lists due, unleased rounds as DueRound and leaves the lease and attempts alone (ALL-125)", async () => {
    const u = await newUser();
    const person = (
      await held.pg.query(
        `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
         values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
        [u.userId],
      )
    ).rows[0].id as string;
    const occasion = (
      await held.pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [u.userId, person])
    ).rows[0].id as string;
    const insert = async (year: number, deadlineDays: number, status: string, lock: string) =>
      (
        await held.pg.query(
          `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, locked_until)
           values ($1, $2, $3, $4, current_date + 90, current_date + $5::int, 20000, $6, now() - interval '1 hour', ${lock}) returning id`,
          [u.userId, person, occasion, year, deadlineDays, status],
        )
      ).rows[0].id as string;
    const due = await insert(2031, 30, "scheduled", "null");
    const leased = await insert(2032, 20, "scheduled", "now() + interval '10 minutes'");
    const deadline = (await held.pg.query("select ship_by_deadline::text as d from concierge.gift_rounds where id = $1", [due])).rows[0].d as string;

    const rows = (await wiring(new Date(Date.now() + 1000), { zinc: false }).engine.store.dueRounds(new Date(Date.now() + 1000))).filter((r) =>
      [due, leased].includes(r.id),
    );
    expect(rows).toEqual([{ id: due, userId: u.userId, status: "scheduled", attentionReason: null, shipByDeadline: deadline }]);
    const after = await held.pg.query("select locked_until, attempts from concierge.gift_rounds where id = $1", [due]);
    expect(after.rows[0]).toEqual({ locked_until: null, attempts: 0 });
  });

  // ─── ALL-27: a round's idea runs, counted in the real database ───────────

  it("a fact saved after the runs are spent gets one more run on the next tick", async () => {
    const u = await newUser();
    const person = (
      await held.pg.query(
        `insert into public.people (user_id, name, relationship, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
         values ($1, 'Mary', 'friend', 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US') returning id`,
        [u.userId],
      )
    ).rows[0].id as string;
    const addFact = (value: string) =>
      held.pg.query("insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($1, $2, 'interest', $3, 'question')", [
        u.userId,
        person,
        value,
      ]);
    await addFact("fly fishing");
    const occasion = await held.pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.userId,
      person,
    ]);
    const roundId = (
      await held.pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
         values ($1, $2, $3, 2030, current_date + 40, current_date + 30, 20000, 'scheduled', now()) returning id`,
        [u.userId, person, occasion.rows[0].id],
      )
    ).rows[0].id as string;

    // Each run is counted the way start_idea_run counts it, and finds nothing.
    const generateIdeas = vi.fn(async (round: { id: string; userId: string; personId: string }): Promise<IdeaOutcome> => {
      await held.pg.query(
        "insert into concierge.idea_runs (user_id, person_id, round_id, finished_at, outcome) values ($1, $2, $3, now(), 'none')",
        [round.userId, round.personId, round.id],
      );
      return { status: "none" };
    });
    // The real store and SQL, with the tick kept to this one round: other files' rounds stay as they are.
    const tick = async () => {
      const now = new Date(Date.now() + 1000);
      const { engine: deps } = wiring(now, { zinc: false });
      const real = deps.store;
      const store = {
        ...real,
        candidates: async () => [],
        claimDue: async (at: Date) => [await real.claim(roundId, at)].filter((r) => r !== null),
        roundsWithRejectedAddresses: async () => [],
        roundsMissingOrderedEmail: async () => [],
      };
      return runTick({ ...deps, store, generateIdeas, clock: Date.now });
    };

    await tick(); // run 1: nothing; runs are left
    await tick(); // run 2: nothing; the runs are spent
    await tick(); // no_ideas
    await tick(); // waits for the deadline
    expect(generateIdeas).toHaveBeenCalledTimes(2);
    expect(await sends(roundId)).toEqual(["no_ideas"]);
    expect(inbox(u)).toEqual(["Sorry, we couldn't get gift ideas for Mary yet@0"]);
    expect((await roundRow(roundId)).status).toBe("generating");

    // A new fact brings the round forward (the fact trigger), and allows one more run.
    await addFact("loves hiking");
    await tick(); // run 3: nothing again
    await tick(); // no_ideas_again
    await tick(); // no more runs, ever
    expect(generateIdeas).toHaveBeenCalledTimes(3);
    expect(await sends(roundId)).toEqual(["no_ideas", "no_ideas_again"]);
    expect(textFor(u)[1]).toContain("We tried again and still couldn't find a good fit for Mary.");
    const runs = await held.pg.query("select count(*)::int as n from concierge.idea_runs where round_id = $1", [roundId]);
    expect(runs.rows[0].n).toBe(3);
  });

  it("held gifts are still placed when tick_deadline_ms can't be read, and no idea run starts", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r); // held for funds
    held.zinc.balance = 100_000;
    const waiting = (
      await held.pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
         select user_id, person_id, occasion_id, 2031, current_date + 40, current_date + 30, 20000, 'scheduled', now() from concierge.gift_rounds where id = $1
         returning id`,
        [r.roundId],
      )
    ).rows[0].id as string;
    const generateIdeas = vi.fn(async (): Promise<IdeaOutcome> => ({ status: "none" }));

    const now = dayAt(23);
    const { engine: deps } = wiring(now);
    const real = deps.store;
    // The real store, kept to these two rounds, with the ideas setting broken.
    const store = {
      ...real,
      setting: async (key: string) => {
        if (key === "tick_deadline_ms") throw new Error("Setting tick_deadline_ms is missing.");
        return real.setting(key);
      },
      candidates: async () => [],
      claimDue: async (at: Date) => (await Promise.all([r.roundId, waiting].map((id) => real.claim(id, at)))).filter((x) => x !== null),
      roundsWithRejectedAddresses: async () => [],
      roundsMissingOrderedEmail: async () => [],
    };
    await runTick({ ...deps, store, generateIdeas, zinc: { ...deps.zinc!, sweep: async () => 0 } });

    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect(held.zinc.posts).toHaveLength(1);
    expect(generateIdeas).not.toHaveBeenCalled();
    expect(await roundRow(waiting)).toMatchObject({ status: "scheduled", locked_until: null });
  });

  // Controller ruling: the tick's deadline never releases a held round; it only bounds the idea pass.
  it("held gifts are still placed when the tick's deadline has already passed, and no idea run starts", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r); // held for funds
    held.zinc.balance = 100_000;
    const waiting = (
      await held.pg.query(
        `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
         select user_id, person_id, occasion_id, 2031, current_date + 40, current_date + 30, 20000, 'scheduled', now() from concierge.gift_rounds where id = $1
         returning id`,
        [r.roundId],
      )
    ).rows[0].id as string;
    const generateIdeas = vi.fn(async (): Promise<IdeaOutcome> => ({ status: "none" }));

    const now = dayAt(23);
    const { engine: deps } = wiring(now);
    const real = deps.store;
    // The real store, kept to these two rounds, with no time at all before the tick's deadline.
    const store = {
      ...real,
      setting: async (key: string) => {
        if (key === "tick_deadline_ms") return 0;
        return real.setting(key);
      },
      candidates: async () => [],
      claimDue: async (at: Date) => (await Promise.all([r.roundId, waiting].map((id) => real.claim(id, at)))).filter((x) => x !== null),
      roundsWithRejectedAddresses: async () => [],
      roundsMissingOrderedEmail: async () => [],
    };
    await runTick({ ...deps, store, generateIdeas, zinc: { ...deps.zinc!, sweep: async () => 0 } });

    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect(held.zinc.posts).toHaveLength(1);
    expect(generateIdeas).not.toHaveBeenCalled();
    expect(await roundRow(waiting)).toMatchObject({ status: "scheduled", locked_until: null });
  });

});
