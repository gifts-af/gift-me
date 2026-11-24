import { describe, expect, it, vi } from "vitest";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { runReactions } from "../reactions/ask";
import { saveReaction } from "../reactions/reactions";
import { createSupabaseRoundStore } from "../rounds/store";
import { BASE, captureLog, named } from "./round-engine-fakes";
import { heldRounds, type User } from "./round-engine-held";

vi.mock("server-only", () => ({}));

// Asking how the gifts went over, with the real store and the real local database (E5); only the
// email service is faked. Only this file's users are asked (ownStaleOrders), and the days are long
// past, so a close on them closes nobody else's unanswered round.

captureLog();

const stack = await localStack({ api: true });
const OCCASION = "2001-01-01";
/** The asked-on day: one after the last gift came (the settings ship at 1 and 7 days). */
const ASKED_ON = "2001-01-06";

describe.skipIf(!stack)("asking how the gifts went (real local database)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { newUser, newRound, sends, inbox, textFor } = held;

  /** A delivered round with two delivered gifts, the last one four days after the occasion. */
  async function deliveredRound(u: User, o: { status?: string } = {}) {
    const r = await newRound(u, { totals: [4200, 3000] });
    const orderIds: string[] = [];
    for (const ideaId of r.ideaIds) {
      const { rows } = await held.pg.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, delivered_at,
                                       ship_to, ship_city, ship_state, created_at)
         values ($1, $2, $3, 'zinc_wallet', 4500, 100, 'delivered', '2001-01-05T12:00:00Z', 'recipient', 'Dayton', 'OH', now() + $4 * interval '1 second')
         returning id`,
        [u.userId, r.roundId, ideaId, orderIds.length],
      );
      orderIds.push(rows[0].id);
    }
    await held.pg.query(
      `update concierge.gift_rounds set status = $2::concierge.round_status, next_action_at = null, occasion_date = $3::date, occasion_year = 2001,
              ship_by_deadline = $3::date - 10 where id = $1`,
      [r.roundId, o.status ?? "delivered", OCCASION],
    );
    // Becoming delivered stamps now(); these rounds belong in the past.
    await held.pg.query("update concierge.gift_rounds set delivered_at = '2001-01-05T12:00:00Z' where id = $1", [r.roundId]);
    return { ...r, orderIds };
  }
  const run = (day: string) => {
    const { engine } = held.wiring(new Date(`${day}T12:00:00Z`));
    return runReactions({ store: createSupabaseRoundStore(ownStaleOrders(held.client(), held.users)), notify: engine.notify, now: engine.now });
  };
  const status = async (id: string) => (await held.pg.query("select status::text as s from concierge.gift_rounds where id = $1", [id])).rows[0].s;
  const answer = (u: User, orderId: string) =>
    saveReaction({ userId: u.userId, orderId, rating: "liked", note: null }, { db: held.client(), now: new Date(`${ASKED_ON}T10:00:00Z`) });

  it("asks once, the day after the last gift came, about every delivered gift (AC-1, AC-3)", async () => {
    const u = await newUser();
    const r = await deliveredRound(u);
    await run("2001-01-05");
    expect(inbox(u)).toEqual([]);
    await run(ASKED_ON);
    expect(textFor(u)).toHaveLength(1);
    for (const o of r.orderIds) expect(textFor(u)[0]).toContain(`Loved it: ${BASE}/rounds/${r.roundId}/reaction?gift=${o}&r=loved`);
    expect(textFor(u)[0].indexOf(r.orderIds[0])).toBeLessThan(textFor(u)[0].indexOf(r.orderIds[1]));
    expect(await sends(r.roundId)).toContain("reaction_prompt");
    await run(ASKED_ON);
    await run("2001-01-07");
    expect(textFor(u)).toHaveLength(1);
  });

  it.each(["ordered", "needs_attention", "skipped"])("a round that's %s isn't asked or closed (AC-2)", async (s) => {
    const u = await newUser();
    const r = await deliveredRound(u, { status: s });
    await run(ASKED_ON);
    expect(inbox(u)).toEqual([]);
    expect(await status(r.roundId)).toBe(s);
  });

  it("two runs at once send one email", async () => {
    const u = await newUser();
    await deliveredRound(u);
    await Promise.all([run(ASKED_ON), run(ASKED_ON)]);
    expect(textFor(u)).toHaveLength(1);
  });

  it("asks only about the unanswered gift, and closes instead when none is left", async () => {
    const u = await newUser();
    const one = await deliveredRound(u);
    expect((await answer(u, one.orderIds[0])).ok).toBe(true);
    await run(ASKED_ON);
    expect(textFor(u)).toHaveLength(1);
    expect(textFor(u)[0]).not.toContain(one.orderIds[0]);
    expect(textFor(u)[0]).toContain(one.orderIds[1]);
    // The last unanswered gift turns out store-cancelled, so nothing is left to answer.
    await held.pg.query("update concierge.orders set status = 'cancelled' where id = $1", [one.orderIds[1]]);
    await run("2001-01-07");
    expect(await status(one.roundId)).toBe("complete");
    expect(textFor(u)).toHaveLength(1);
  });

  it("past its close date, closes with no email (AC-7)", async () => {
    const u = await newUser();
    const r = await deliveredRound(u);
    const { closed } = await run("2001-01-13");
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(await status(r.roundId)).toBe("complete");
    expect(inbox(u)).toEqual([]);
  });

  it("a refused email gives the key back and goes the next day (AC-14)", async () => {
    const u = await newUser();
    const r = await deliveredRound(u);
    held.refuseTo.add(u.email);
    await run(ASKED_ON);
    expect(await sends(r.roundId)).not.toContain("reaction_prompt");
    expect(named("reactions.ask_failed")).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
    held.refuseTo.delete(u.email);
    await run("2001-01-07");
    expect(textFor(u)).toHaveLength(1);
  });

  it("answered or removed between being found and being read: no email, and the key goes back", async () => {
    for (const change of ["answered", "person removed"]) {
      const u = await newUser();
      const r = await deliveredRound(u);
      const store = createSupabaseRoundStore(ownStaleOrders(held.client(), held.users));
      const { engine } = held.wiring(new Date(`${ASKED_ON}T12:00:00Z`));
      const racing = {
        ...store,
        reactionGifts: async (id: string) => {
          if (change === "answered") for (const o of r.orderIds) await answer(u, o);
          else
            await held.pg.query(
              "update public.people set deleted_at = now() where id = (select person_id from concierge.gift_rounds where id = $1)",
              [r.roundId],
            );
          return store.reactionGifts(id);
        },
        reactionsDue: async (day: string) => (await store.reactionsDue(day)).filter((x) => x.roundId === r.roundId),
      };
      await runReactions({ store: racing, notify: engine.notify, now: engine.now });
      expect(inbox(u), change).toEqual([]);
      expect(await sends(r.roundId), change).not.toContain("reaction_prompt");
    }
    expect(named("reactions.ask_failed")).toEqual([]);
  });

  it("switched off: nothing asked, closed or alerted (AC-13)", async () => {
    const u = await newUser();
    const due = await deliveredRound(u);
    await held.pg.query("update concierge.app_settings set value = '0' where key = 'reactions_enabled'");
    try {
      expect(await run(ASKED_ON)).toEqual({ closed: 0, asked: 0 });
      expect(await run("2001-01-13")).toEqual({ closed: 0, asked: 0 });
    } finally {
      await held.pg.query("update concierge.app_settings set value = '1' where key = 'reactions_enabled'");
    }
    expect(inbox(u)).toEqual([]);
    expect(await status(due.roundId)).toBe("delivered");
    expect(named("reactions.ask_failed")).toEqual([]);
  });
});
