import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { addDays } from "@gifts-af/core";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { replaceFailedOrder } from "../purchase/replace";
import { advanceRound, type EngineDeps } from "../rounds/engine";
import { createSupabaseRoundStore } from "../rounds/store";
import { runTrackingNews } from "../tracking/news";
import { retryOrderedEmails, tellOrdered } from "../rounds/money-path";
import { handleZincWebhook } from "../zinc/events";
import { heldRounds, type User } from "./round-engine-held";
import { BASE, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Store cancellations (ALL-33 AC-8, AC-9): Zinc's order.cancelled through the real webhook, the
// real engine and the real local database (E5); only Zinc and the email service are faked.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("store cancellations (real local database, fake Zinc)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, engine, advance, approve, newUser, newRound, roundRow, sends, inbox } = held;
  const hooks = new Map<string, { webhookId: string; secret: string }>();

  /** The user's Zinc account again, with a webhook id and secret this test knows. */
  async function webhookFor(u: User) {
    const webhookId = randomUUID();
    const secret = `zn_whsec_${randomUUID()}`;
    await held.pg.query("select concierge.zinc_store_secrets($1, $2, $3, $4, 'test')", [u.userId, `zn_test_${u.userId}`, secret, webhookId]);
    hooks.set(u.userId, { webhookId, secret });
  }

  /**
   * A round with its first `placed` gifts bought and placed with Zinc (Walmart, $42.18 each), the
   * rest still proposed. Ids in rank order.
   */
  async function boughtRound(u: User, o: { totals?: number[]; placed?: number } = {}) {
    await webhookFor(u);
    const r = await newRound(u, { totals: o.totals ?? [4200] });
    await held.pg.query("update concierge.gift_ideas set retailer = 'walmart' where round_id = $1", [r.roundId]);
    const picks = r.ideaIds.slice(0, o.placed ?? 1);
    for (const id of picks) held.zinc.plan.set(`https://shop.test/p/${id}`, ["timeout"]);
    await approve(u, { roundId: r.roundId, ideaIds: picks });
    const rows = await held.pg.query(
      "select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank",
      [r.roundId],
    );
    const orderIds = rows.rows.map((x) => x.id as string);
    const zincIds: string[] = [];
    for (const id of orderIds) {
      const zincId = randomUUID();
      zincIds.push(zincId);
      await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where id = $1", [id]);
      await held.pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', $3::jsonb)", [
        u.userId,
        id,
        JSON.stringify({ provider_order_id: zincId, total_cents: 4218 }),
      ]);
    }
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    return { ...r, orderIds, zincIds };
  }

  /**
   * Zinc's order.cancelled for `zincId`, arriving on day `n`, wired as the app's route does.
   * `data` is the event's data: by default a refund of the whole $42.18.
   */
  async function storeCancels(u: User, zincId: string, n: number, o: { engine?: EngineDeps; data?: Record<string, unknown> } = {}) {
    const now = dayAt(n);
    const { engine: eng, purchase } = wiring(now);
    const e = o.engine ?? eng;
    const hook = hooks.get(u.userId)!;
    const body = JSON.stringify({ event: "order.cancelled", order_id: zincId, timestamp: now.toISOString(), data: o.data ?? { refund_amount: 4218 } });
    const sig = createHmac("sha256", hook.secret).update(body).digest("hex");
    return handleZincWebhook(hook.webhookId, body, sig, {
      ...purchase,
      placeHeld: async () => {},
      advanceRound: (roundId) => advanceRound(roundId, e, { justPlaced: true }),
      orderPlaced: (roundId) => tellOrdered(roundId, e),
      tellDelivered: async () => {},
      setting: async (key) => Number((await held.pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value),
    });
  }

  const orderRow = async (id: string) =>
    (await held.pg.query("select status, failure_type, resolved, failed_after_close from concierge.orders where id = $1", [id])).rows[0];
  const lastText = (u: User) => mail.filter((m) => m.to === u.email).at(-1)!.text;

  it("cancel before ship-by emails the failure with the store wording and the fix link (AC-8)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    const before = inbox(u).length;
    expect(await storeCancels(u, r.zincIds[0], 1)).toEqual({ status: 200 });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", failure_type: "store_cancelled", resolved: false });
    expect(inbox(u).slice(before)).toEqual(["Sorry, there's a problem with Mary's gift@1"]);
    const text = lastText(u);
    expect(text).toContain("Walmart cancelled the Stoneware mug set, and the $42.18 is back in your Zinc wallet.");
    expect(text).toContain(`Review the gift: ${BASE}/rounds/${r.roundId}/fix/${r.orderIds[0]}`);
    expect(text).toContain("Choose another gift by");
    expect(await sends(r.roundId)).toContain(`fail:${r.orderIds[0]}`);
    // Told once.
    await advance(r.roundId, 2);
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("two store cancels before one look: one summary, each row with the store wording", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    for (const id of r.orderIds) await held.pg.query("select concierge.store_cancel_order($1, $2, current_date + 1, null)", [u.userId, id]);
    const before = inbox(u).length;
    await advance(r.roundId, 1);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled 2 of Mary's Christmas gifts@1"]);
    const text = lastText(u);
    expect(text).toContain("The store cancelled 2 of the gifts we ordered for Mary's Christmas");
    expect(text).toContain("The money for them is back in your Zinc wallet.");
    expect(text).toContain("- Stoneware mug set (The store cancelled it, and the money is back in your Zinc wallet. Choose another gift.)");
    expect(text).toContain("- Linen apron (The store cancelled it, and the money is back in your Zinc wallet. Choose another gift.)");
    expect(text).not.toMatch(/haven't been charged|couldn't be bought/);
  });

  it("a store cancel and an out-of-stock gift before one look: one summary that never says the cancelled one wasn't charged", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    await held.pg.query("select concierge.store_cancel_order($1, $2, current_date + 1, null)", [u.userId, r.orderIds[0]]);
    await held.pg.query("update concierge.orders set status = 'failed', failure_type = 'out_of_stock', failed_at = now() where id = $1", [r.orderIds[1]]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    const before = inbox(u).length;
    await advance(r.roundId, 1);
    expect(inbox(u).slice(before)).toEqual(["Sorry, 2 of Mary's Christmas gifts need another choice@1"]);
    const text = lastText(u);
    expect(text).toContain("the store cancelled 1 and 1 didn't go through.");
    expect(text).toContain("The money for the cancelled gift is back in your Zinc wallet, and you haven't been charged for the other.");
    expect(text).not.toMatch(/couldn't be bought|haven't been charged for either/);
  });

  it("after the replacement the cancelled order no longer counts toward the budget (AC-8)", async () => {
    const u = await newUser({ autoTopUp: null });
    // Budget $200: the cancelled $150 gift plus the $90 replacement would be over it.
    const r = await boughtRound(u, { totals: [15000, 9000] });
    await held.pg.query("update concierge.orders set max_price_cents = 15000 where id = $1", [r.orderIds[0]]);
    await storeCancels(u, r.zincIds[0], 1);
    const result = await replaceFailedOrder(
      { userId: u.userId, roundId: r.roundId, failedOrderId: r.orderIds[0], ideaId: r.ideaIds[1] },
      { ...wiring(dayAt(1)).purchase, lookup: null, recordCost: async () => {} },
    );
    expect(result).toMatchObject({ ok: true });
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", failure_type: "store_cancelled", resolved: true });
    const live = await held.pg.query(
      "select count(*)::int as n from concierge.orders where round_id = $1 and concierge.order_is_given(status, resolved)",
      [r.roundId],
    );
    expect(live.rows[0].n).toBe(1);
  });

  it("cancel after ship-by sends nothing now and leaves the order resolved; no 'No gift was chosen' (AC-9)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    const before = inbox(u).length;
    await storeCancels(u, r.zincIds[0], 30);
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", resolved: true, failed_after_close: false });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    await retryOrderedEmails(engine(dayAt(30)));
    expect(inbox(u).slice(before)).toEqual([]);
    // The daily news run (its own step) tells it, once.
    const due = await held.pg.query("select order_id from concierge.tracking_candidates(current_date + 30) where order_id = $1", [r.orderIds[0]]);
    expect(due.rowCount).toBe(1);
  });

  it("cancel on an ordered round with closed_at set: no failed_late, and the news run has it once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    await held.pg.query("update concierge.gift_rounds set closed_at = now() where id = $1", [r.roundId]);
    // The "ordered" emails go first, so only what the cancel causes is left to see.
    await retryOrderedEmails(engine(dayAt(0)));
    const before = inbox(u).length;
    await storeCancels(u, r.zincIds[0], 1);
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", resolved: true, failed_after_close: false });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u).slice(before)).toEqual([]);
    expect(await sends(r.roundId)).not.toContain(`late_fail:${r.orderIds[0]}`);
    const due = await held.pg.query("select order_id from concierge.tracking_candidates(current_date + 1) where order_id = $1", [r.orderIds[0]]);
    expect(due.rowCount).toBe(1);
  });

  it("a store cancel told before ship-by and never replaced: the deadline says the store cancelled it, not 'No gift was chosen'", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    await storeCancels(u, r.zincIds[0], 1);
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@30"]);
    const text = lastText(u);
    expect(text).toContain("Walmart cancelled the Stoneware mug set");
    expect(text).toContain("The $42.18 is back in your Zinc wallet.");
    expect(text).toContain("It's too late for us to ship another gift in time.");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    const steps = await sends(r.roundId);
    expect(steps).toContain(`cancel_late:${r.orderIds[0]}`);
    expect(steps).not.toContain("skipped");
    // Never again: not by the engine, not by the news run.
    await advance(r.roundId, 31);
    expect(inbox(u).slice(before)).toHaveLength(1);
    const due = await held.pg.query("select 1 from concierge.tracking_candidates(current_date + 31) where order_id = $1", [r.orderIds[0]]);
    expect(due.rowCount).toBe(0);
  });

  it("the deadline's store-cancelled email refused: the round stays open and the next look sends it", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    await storeCancels(u, r.zincIds[0], 1);
    const before = inbox(u).length;
    held.refuse = true;
    await advance(r.roundId, 30);
    held.refuse = false;
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention" });
    expect(await sends(r.roundId)).not.toContain(`cancel_late:${r.orderIds[0]}`);
    await advance(r.roundId, 31);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@31"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
  });

  it('ship-by-day race: a told failure plus a store cancel ends skipped with the store wording, once, and no "No gift was chosen"', async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    // The apron fails (told on day 1); the mug is on its way.
    await held.pg.query("update concierge.orders set status = 'failed', failure_type = 'out_of_stock', failed_at = now() where id = $1", [r.orderIds[1]]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    await advance(r.roundId, 1);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@1"]);

    // On the ship-by day the deadline run reads the mug as placed, then the store cancels it
    // while the run is closing the round.
    const { engine: eng } = wiring(dayAt(30));
    const store = eng.store;
    const racing: EngineDeps = {
      ...eng,
      store: {
        ...store,
        cancelHeld: async (id) => {
          await storeCancels(u, r.zincIds[0], 30);
          return store.cancelHeld(id);
        },
      },
    };
    await advanceRound(r.roundId, racing);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@1", "Sorry, the store cancelled Mary's gift@30"]);
    expect(lastText(u)).toContain("Walmart cancelled the Stoneware mug set");
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderIds[0]}`);
    // Once: the news run has nothing left to tell.
    const due = await held.pg.query("select 1 from concierge.tracking_candidates(current_date + 30) where order_id = $1", [r.orderIds[0]]);
    expect(due.rowCount).toBe(0);
    await advance(r.roundId, 31);
    expect(inbox(u)).toHaveLength(2);
  });

  // ─── The deadline: every path that covers a store cancel uses its own wording, once ───

  /** Emails naming the cancelled mug that also say nothing was charged: there must be none. */
  // Named as another failure's good news ("ordered and on its way"), it isn't what wasn't charged for.
  const noChargeClaim = (u: User) =>
    mail.filter((m) => m.to === u.email && /Stoneware mug set/.test(m.text.replace("The good news: the Stoneware mug set is ordered and on its way.", "")) && /haven't been charged/.test(m.text));

  it("a cancel on the ship-by day before the deadline look: the store wording once, no 'No gift was chosen'", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    // The apron failed and was told: it keeps the round open past the cancel below.
    await held.pg.query("update concierge.orders set status = 'failed', failure_type = 'out_of_stock', failed_at = now() where id = $1", [r.orderIds[1]]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    await advance(r.roundId, 1);
    const before = inbox(u).length;
    // The round is still open (the told apron), so the webhook's own engine call may close it;
    // the deadline look follows either way.
    await storeCancels(u, r.zincIds[0], 30);
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", resolved: true });
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@30"]);
    expect(lastText(u)).toContain("Walmart cancelled the Stoneware mug set");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderIds[0]}`);
    const due = await held.pg.query("select 1 from concierge.tracking_candidates(current_date + 30) where order_id = $1", [r.orderIds[0]]);
    expect(due.rowCount).toBe(0);
    expect(noChargeClaim(u)).toEqual([]);
  });

  it("an untold store cancel at the deadline gets the store wording, not 'we couldn't buy it'; no refund_amount means no amount", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    // The cancel's own email is refused, so it's still untold on the ship-by day.
    held.refuse = true;
    // Zinc didn't say what came back: the order's own total ($42.18) is never said instead.
    await storeCancels(u, r.zincIds[0], 1, { data: {} });
    held.refuse = false;
    expect(await sends(r.roundId)).not.toContain(`fail:${r.orderIds[0]}`);
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@30"]);
    const text = lastText(u);
    expect(text).toContain("The money is back in your Zinc wallet.");
    expect(text).not.toMatch(/\$\d/);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining([`cancel_late:${r.orderIds[0]}`, `fail:${r.orderIds[0]}`]));
    expect(noChargeClaim(u)).toEqual([]);
    await advance(r.roundId, 31);
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("with ordering paused at the deadline, a told store cancel gets the store wording, not 'missed on us'", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    await storeCancels(u, r.zincIds[0], 1);
    await held.pg.query("update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled'");
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@30"]);
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderIds[0]}`);
    expect(await sends(r.roundId)).not.toContain("missed_on_us");
    expect(noChargeClaim(u)).toEqual([]);
  });

  it("a held gift plus a told store cancel, nothing placed: the store wording for one, the held email for the other", async () => {
    const u = await newUser({ autoTopUp: null });
    await webhookFor(u);
    const r = await newRound(u, { totals: [4200, 3000] });
    await held.pg.query("update concierge.gift_ideas set retailer = 'walmart' where round_id = $1", [r.roundId]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [mug] = (
      await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])
    ).rows.map((x) => x.id as string);
    const zincId = randomUUID();
    await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where id = $1", [mug]);
    await held.pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', $3::jsonb)", [
      u.userId,
      mug,
      JSON.stringify({ provider_order_id: zincId, total_cents: 4218 }),
    ]);
    await storeCancels(u, zincId, 1);
    expect(await orderRow(mug)).toMatchObject({ status: "failed", failure_type: "store_cancelled" });
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    const got = inbox(u).slice(before);
    expect(got).toContain("Sorry, the store cancelled Mary's gift@30");
    expect(got).toContain("Sorry, we couldn't buy all of Mary's gifts in time@30");
    expect(got.filter((x) => x.startsWith("No gift"))).toEqual([]);
    expect(await sends(r.roundId)).toContain(`cancel_late:${mug}`);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(noChargeClaim(u)).toEqual([]);
  });

  it("the emails state Zinc's refund_amount, not what we were charged (owner, 2026-11-23)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u);
    const before = inbox(u).length;
    await storeCancels(u, r.zincIds[0], 1, { data: { refund_amount: 4050 } });
    expect(inbox(u).slice(before)).toEqual(["Sorry, there's a problem with Mary's gift@1"]);
    expect(lastText(u)).toContain("Walmart cancelled the Stoneware mug set, and the $40.50 is back in your Zinc wallet.");
    expect(lastText(u)).not.toContain("$42.18");
    // And at the deadline, when it was never replaced.
    await advance(r.roundId, 30);
    expect(lastText(u)).toContain("The $40.50 is back in your Zinc wallet.");
    expect(lastText(u)).not.toContain("$42.18");
  });

  // ─── A close that isn't the deadline never tells a store cancel as "not charged" ───

  /** The daily news run on day `n` for `u`'s orders only, wired as the tick does it. */
  function news(u: User, n: number) {
    const { engine: eng } = wiring(dayAt(n));
    return runTrackingNews({
      store: createSupabaseRoundStore(ownStaleOrders(held.client(), [u.userId])),
      notify: eng.notify,
      today: addDays(held.today, n),
      setting: async (key) => Number((await held.pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value),
    });
  }

  /** A bought round whose store cancel's own email was refused, so it's still untold. */
  async function untoldCancel(u: User) {
    const r = await boughtRound(u);
    await retryOrderedEmails(engine(dayAt(0)));
    held.refuse = true;
    await storeCancels(u, r.zincIds[0], 1);
    held.refuse = false;
    expect(await sends(r.roundId)).not.toContain(`fail:${r.orderIds[0]}`);
    return r;
  }

  async function removePerson(roundId: string) {
    const person = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id;
    await held.pg.query("update public.people set deleted_at = now() where id = $1", [person]);
    await held.pg.query("select concierge.skip_open_rounds($1, null)", [person]);
  }

  it.each([
    ["the cancel link", (roundId: string) => held.pg.query("select concierge.cancel_held($1, 'cancel')", [roundId])],
    ["the person removed", removePerson],
  ])("an untold store cancel, then %s closes the round: the store wording once from the news run, never 'not charged'", async (_, close) => {
    const u = await newUser({ autoTopUp: null });
    const r = await untoldCancel(u);
    const before = inbox(u).length;
    await close(r.roundId);
    expect(await orderRow(r.orderIds[0])).toMatchObject({ status: "failed", resolved: true, failed_after_close: false });
    // The tick's late-email retry finds nothing to say.
    await retryOrderedEmails(engine(dayAt(1)));
    expect(inbox(u).slice(before)).toEqual([]);
    expect(await sends(r.roundId)).not.toContain(`late_fail:${r.orderIds[0]}`);
    expect(await news(u, 1)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@1"]);
    expect(lastText(u)).toContain("Walmart cancelled the Stoneware mug set");
    expect(lastText(u)).toContain("The $42.18 is back in your Zinc wallet.");
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderIds[0]}`);
    expect(await news(u, 2)).toEqual({ sent: 0 });
    expect(noChargeClaim(u)).toEqual([]);
  });

  it("a store cancel somehow handed to the late email is still never told as 'not charged'", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await untoldCancel(u);
    await held.pg.query("select concierge.cancel_held($1, 'cancel')", [r.roundId]);
    // As older code, or a path we haven't thought of, might leave it.
    await held.pg.query("update concierge.orders set failed_after_close = true where id = $1", [r.orderIds[0]]);
    const before = inbox(u).length;
    await tellOrdered(r.roundId, engine(dayAt(1)));
    expect(inbox(u).slice(before)).toEqual([]);
    expect(noChargeClaim(u)).toEqual([]);
  });

  it("a store cancel landing while the deadline claims its failure email: the late email names only the other gift", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await boughtRound(u, { totals: [4200, 3000], placed: 2 });
    await retryOrderedEmails(engine(dayAt(0)));
    // The apron fails on the ship-by day: untold when the deadline look starts.
    await held.pg.query("update concierge.orders set status = 'failed', failure_type = 'out_of_stock', failed_at = now() where id = $1", [r.orderIds[1]]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    const before = inbox(u).length;
    const { engine: eng } = wiring(dayAt(30));
    const store = eng.store;
    const racing: EngineDeps = {
      ...eng,
      store: {
        ...store,
        // The store's cancel was dated the day before ship-by, so it lands untold, just before the claim.
        claimFailureNotices: async (id) => {
          await held.pg.query("select concierge.store_cancel_order($1, $2, current_date + 29, 4218)", [u.userId, r.orderIds[0]]);
          return store.claimFailureNotices(id);
        },
      },
    };
    await advanceRound(r.roundId, racing);
    expect(noChargeClaim(u)).toEqual([]);
    expect(inbox(u).slice(before)).toContain("Sorry, the store cancelled Mary's gift@30");
    const late = mail.filter((m) => m.to === u.email && m.text.includes("Linen apron"));
    expect(late.at(-1)!.text).not.toContain("Stoneware mug set");
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderIds[0]}`);
  });
});
