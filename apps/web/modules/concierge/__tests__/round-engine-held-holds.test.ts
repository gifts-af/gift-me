import { addDays } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";
import { confirmActionLink } from "../notify/links";
import { createSupabaseNotifyStore } from "../notify/store";
import { approveAndBuy } from "../purchase/approve";
import { sweepStalePlacing } from "../purchase/place";
import { advanceRound } from "../rounds/engine";
import { retryOrderedEmails, tellOrdered } from "../rounds/money-path";
import { heldRounds } from "./round-engine-held";
import { BASE, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Held rounds: holds, placing, reminders and the deadline.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("held rounds: holds and the deadline (real local database, fake Zinc; AC-19, AC-22 to AC-24)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, client, dayAt, wiring, engine, advance, approve, newUser, connect, newRound, approvedRound, roundRow, orderRows, sends, inbox, walletReads } = held;

  it("tells the buyer on the hold day, tries placing daily, reminds at -7 and -2, then skips at the deadline", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;

    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    for (let day = 1; day < 30; day++) expect(await advance(r.roundId, day)).toBe("advanced");
    const waiting = "Sorry, Mary's gift is waiting on your Zinc balance";
    expect(inbox(u)).toEqual([`${waiting}@0`, `${waiting}@23`, `${waiting}@28`]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:1:reminder", "hold:1:final"]));
    // One look at the wallet a day, and nothing ever sent to Zinc.
    expect(walletReads()).toBe(30);
    expect(held.zinc.posts).toEqual([]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds", locked_until: null });

    expect(await advance(r.roundId, 30)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped", next_action_at: null, locked_until: null });
    expect(await orderRows(r.roundId)).toEqual([{ status: "cancelled", hold_reason: "funds", failure_type: "held_expired" }]);
    const last = mail.filter((m) => m.to === u.email).at(-1)!;
    expect(last.subject).toBe("Sorry, we couldn't buy Mary's gift in time");
    expect(last.text).toContain("couldn't be bought in time, so we didn't buy it and you haven't been charged.");
  }, 60_000);

  // S1: the app builds its wiring (and its `now`) when the request starts; reconcile_round then
  // makes the round due at the database's later now(). The hold notice must still go out in the
  // same request, not wait for the next tick.
  it("approving into a funds hold emails the buyer in the same request, with the wiring's clock behind the database's", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    const { purchase } = wiring(new Date(Date.now() - 5000));
    expect(await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, purchase)).toEqual({
      ok: true,
      status: "held",
      reason: "funds",
    });
    expect(await sends(r.roundId)).toContain("hold:1:notice");
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
    expect(await roundRow(r.roundId)).toMatchObject({ locked_until: null });
  });

  // S6 (owner): the round engine switch doesn't stop a customer hearing about their purchase.
  it("with the round engine switched off, a hold from approval is still emailed at once", async () => {
    await held.pg.query("update concierge.app_settings set value = '0' where key = 'round_engine_enabled'");
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
    expect(await roundRow(r.roundId)).toMatchObject({ locked_until: null });
    // The ordinary path stays off: nothing but the money path moves.
    expect(await advance(r.roundId, 23)).toBe("off");
  });

  // S3: one placing budget per run, set by the engine when the run (the tick) starts and shared
  // by every round it places; once it's spent nothing more is sent to Zinc, and the round still
  // gets what's due (the next tick tries placing again). Here the run's clock is already past it.
  it("stops placing once the run's placing budget is spent", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    let calls = 0;
    // The budget is set on the run's first look at the clock; every later look is past it.
    const engineClock = () => (calls++ === 0 ? 0 : 10_000_000);
    const log = vi.spyOn(console, "log");
    expect(await advanceRound(r.roundId, wiring(dayAt(1), { engineClock }).engine)).toBe("advanced");
    expect(held.zinc.posts).toEqual([]);
    const spent = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "order.place_budget_spent");
    expect(spent).toEqual([expect.objectContaining({ round_id: r.roundId })]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry", locked_until: null });
    // Within the budget it places.
    expect(await advanceRound(r.roundId, wiring(dayAt(2)).engine)).toBe("advanced");
    expect(held.zinc.posts).toHaveLength(1);
  });

  it("names the amounts and says the cost plainly (no Alpha label) and carries the cancel link in the hold email", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    const [m] = mail.filter((x) => x.to === u.email);
    expect(m.text).toContain("Zinc needs $46.20 (the gift with room for a small price change");
    expect(m.text).toContain("You have $10, so you're $36.20 short.");
    expect(m.text).toContain("Top up your Zinc balance: https://zinc.test/wallet");
    expect(m.text).toContain("Topping up means we'll buy the gift: its price plus Zinc's $1 fee.");
    expect(m.text).toMatch(/Cancel this gift: https:\/\/giftsaf\.test\/a\/\S+/);
  });

  it("links the top-up to Paying for gifts when no Zinc wallet link is wired (ALL-115 AC-14)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    // Place through a wiring whose engine has no Zinc deps, so the hold email falls back.
    await approveAndBuy({ userId: u.userId, roundId: r.roundId, ideaIds: r.ideaIds }, wiring(dayAt(0), { zinc: false }).purchase);
    const [m] = mail.filter((x) => x.to === u.email);
    expect(m.text).toContain(`Top up your Zinc balance: ${BASE}/settings/paying`);
  });

  it("sends one 'still short' email a day after a partial top-up (AC-22)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    held.zinc.balance = 3000;
    expect(await advance(r.roundId, 1)).toBe("advanced");
    // The same day again: today's key is taken, nothing more is sent.
    await advanceRound(r.roundId, engine(new Date(`${addDays(held.today, 1)}T18:00:00Z`)));
    await advance(r.roundId, 2); // no change in the balance
    held.zinc.balance = 3500;
    await advance(r.roundId, 3);
    expect(inbox(u)).toEqual([
      "Sorry, Mary's gift is waiting on your Zinc balance@0",
      "You're still $16.20 short for Mary's gift@1",
      "You're still $11.20 short for Mary's gift@3",
    ]);
  });

  it("sends a new notice when the reason changes from setup to funds", async () => {
    const u = await newUser({ connected: false });
    const r = await newRound(u);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "setup", hold_count: 1 });
    await connect(u.userId);
    held.zinc.balance = 1000;
    await advance(r.roundId, 1);
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "funds", hold_count: 2 });
    expect(inbox(u)).toEqual(["Finish setting up payment to send Mary's gift@0", "Sorry, Mary's gift is waiting on your Zinc balance@1"]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:2:notice"]));
  });

  it("buys it once the balance covers it, and stops emailing", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    held.zinc.balance = 100_000;
    await advance(r.roundId, 23); // the reminder day: placing comes first, so no reminder goes out
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect(held.zinc.posts).toHaveLength(1);
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0"]);
  });

  it("at the deadline, one placing and one held → the cancel email first (retried if refused), then ordered", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    // Auto top-up unknown: both are sent; Zinc takes the first and refuses the second.
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
    const before = inbox(u).length;
    // Refused: nothing is cancelled or closed, and the next look tries again.
    held.refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing", "held"]);
    held.refuse = false;
    await held.pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 31);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered", locked_until: null });
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing", "cancelled"]);
    expect(inbox(u).slice(before)).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@31"]);
    const last = mail.filter((m) => m.to === u.email).at(-1)!;
    expect(last.text).toContain("We couldn't buy the Linen apron for Mary's Christmas in time, so we cancelled it. You haven't been charged for it.");
    // The placing one isn't confirmed yet: its own emails say what happens to it.
    expect(last.text).not.toContain("on its way");
    expect(last.text).not.toContain("No gift");
  });

  it("at the deadline, one unconfirmed and one held → the cancel email, then 'still confirming' on the next look", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [first] = (await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    await held.pg.query("select concierge.mark_unconfirmed($1)", [first.id]);
    const before = inbox(u).length;
    await advance(r.roundId, 30);
    await advance(r.roundId, 31);
    expect(inbox(u).slice(before)).toEqual([
      "Sorry, we couldn't buy all of Mary's gifts in time@30",
      "We're confirming Mary's gift with the store@31",
    ]);
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["unconfirmed", "cancelled"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
  });

  it("at the deadline, with the placed one already confirmed: the same email, sent before closing", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    await held.pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, first.id]);
    // The email service is down at the deadline: nothing closes, and the next look tries again.
    held.refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention" });
    held.refuse = false;
    await held.pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    expect(await advance(r.roundId, 31)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    expect(inbox(u).filter((m) => m.startsWith("Sorry, we couldn't buy all of Mary's gifts"))).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@31"]);
  });

  it("tells the buyer it was on us when our switch kept the gift back past the deadline (missed_on_us)", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    // What placeRound does when zinc_ordering_enabled is 0 (set here, not flipped: the switch is shared).
    await held.pg.query("select concierge.gate_held_orders($1, 'paused')", [r.roundId]);
    await advance(r.roundId, 30);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    const [m] = mail.filter((x) => x.to === u.email);
    expect(m.subject).toBe("We're sorry, we couldn't send Mary's gift in time");
    expect(m.text).toContain("That's on us, and we're sorry. Nothing was bought and you haven't been charged.");
  });

  // S8: ordering switched off while a gift waits on funds: no "top up" reminders (topping up
  // wouldn't buy it), and the deadline says it was on us, not "skipped".
  it("with ordering switched off, a funds hold gets no reminders and the deadline sends missed_on_us", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    expect(await approve(u, r)).toEqual({ ok: true, status: "held", reason: "funds" });
    await held.pg.query("update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled'");
    for (const day of [1, 23, 28]) expect(await advance(r.roundId, day)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ attention_reason: "funds" });
    expect(await advance(r.roundId, 30)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is waiting on your Zinc balance@0", "We're sorry, we couldn't send Mary's gift in time@30"]);
    expect(held.zinc.posts).toEqual([]);
  });

  // Re-review: the sweep marks an order unconfirmed and the buyer hears "still confirming" in the
  // same run (owner: customers are always told), and the owner gets an alert (E8).
  it("the sweep tells the buyer at once when Zinc can't find an order, and alerts the owner", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [o] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    const log = vi.spyOn(console, "log");
    await sweepStalePlacing(wiring(new Date(Date.now() + 31 * 60_000)).purchase);
    expect((await held.pg.query("select status from concierge.orders where id = $1", [o.id])).rows[0].status).toBe("unconfirmed");
    expect(await sends(r.roundId)).toContain("hold:1:notice");
    expect(mail.filter((m) => m.to === u.email).map((m) => m.subject)).toEqual(["We're confirming Mary's gift with the store"]);
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "order.unconfirmed" && e.order_id === o.id);
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
  });

  it("an unconfirmed order: told at once, again at the deadline, never skipped", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    // The sweep couldn't find it at Zinc.
    const [order] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await held.pg.query("select concierge.mark_unconfirmed($1)", [order.id]);

    await advance(r.roundId, 1);
    await advance(r.roundId, 10);
    await advance(r.roundId, 30);
    await advance(r.roundId, 31);
    const confirming = "We're confirming Mary's gift with the store";
    expect(inbox(u)).toEqual([`${confirming}@1`, `${confirming}@30`]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "unconfirmed" });
    expect(mail.filter((m) => m.to === u.email).every((m) => !m.text.includes("nothing was bought"))).toBe(true);
  });

  it("a hold that starts 5 days before the deadline: one email that run; the reminder and final come on later days", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: 5 });
    held.zinc.balance = 1000;
    await approve(u, r);
    const waiting = "Sorry, Mary's gift is waiting on your Zinc balance";
    expect(inbox(u)).toEqual([`${waiting}@0`]);
    expect(await sends(r.roundId)).toEqual(["hold:1:notice"]);
    await advance(r.roundId, 1);
    await advance(r.roundId, 2);
    await advance(r.roundId, 3);
    expect(inbox(u)).toEqual([`${waiting}@0`, `${waiting}@1`, `${waiting}@3`]);
    expect(await sends(r.roundId)).toEqual(expect.arrayContaining(["hold:1:notice", "hold:1:reminder", "hold:1:final"]));
  });

  it("a deadline email the email service refuses is tried again on the next look; the round closes only once it went", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    held.refuse = true;
    expect(await advance(r.roundId, 30)).toBe("failed");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "funds" });
    expect(await sends(r.roundId)).not.toContain("skipped");
    held.refuse = false;
    // The failed run's lease runs out by itself; here it's given back so the next look can claim it.
    await held.pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    expect(await advance(r.roundId, 31)).toBe("advanced");
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u).at(-1)).toBe("Sorry, we couldn't buy Mary's gift in time@31");
  });

  it("tells the buyer once per order when Zinc confirms it placed (the ordered email, city only)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    await approve(u, r);
    const placed = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    for (const o of placed) await held.pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, o.id]);
    const deps = engine(dayAt(1));
    await tellOrdered(r.roundId, deps);
    await tellOrdered(r.roundId, deps);
    expect(inbox(u)).toEqual(["Mary's gift is ordered@1", "Mary's gift is ordered@1"]);
    const texts = mail.filter((m) => m.to === u.email).map((m) => m.text);
    expect(texts.some((t) => t.includes("We ordered the Stoneware mug set for Mary's Christmas"))).toBe(true);
    expect(texts.some((t) => t.includes("We ordered the Linen apron for Mary's Christmas"))).toBe(true);
    for (const t of texts) {
      expect(t).toContain("It's on its way to Dayton. We'll let you know when it ships.");
      expect(t).not.toContain("12 Oak St");
    }
    expect((await sends(r.roundId)).filter((s: string) => s.startsWith("ordered:"))).toHaveLength(2);
  });

  it("if the placing gift fails while the round closes, the late email tells it, not 'skipped' (ALL-116 AC-6)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[1]}`, ["402"]);
    await approve(u, r);
    const [first] = (await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])).rows;
    const deps = engine(dayAt(30));
    const real = deps.store;
    // Zinc reports the placing one failed just as the deadline closes the round.
    deps.store = {
      ...real,
      cancelHeld: async (roundId) => {
        await held.pg.query("select concierge.settle_order($1, $2, 'failed', 'out_of_stock', '{}')", [u.userId, first.id]);
        return real.cancelHeld(roundId);
      },
    };
    const before = inbox(u).length;
    await advanceRound(r.roundId, deps);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(inbox(u).slice(before)).toEqual(["Sorry, we couldn't buy all of Mary's gifts in time@30", "We're sorry, we couldn't buy Mary's gift@30"]);
  });

  it("alerts the owner when a refused deadline email keeps a round open past its deadline", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    held.refuse = true;
    const log = vi.spyOn(console, "log");
    await advance(r.roundId, 30);
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_deadline_email_held_open")).toEqual([]);
    await held.pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 31);
    const alerts = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "round_deadline_email_held_open");
    expect(alerts).toEqual([expect.objectContaining({ round_id: r.roundId, user_id: u.userId, alert: true })]);
    expect(Object.keys(alerts[0]).sort()).toEqual(["alert", "at", "event", "round_id", "user_id"]);
  });

  // S2 (owner: customers are always told): a gift still placing at the deadline fails afterwards,
  // or the owner settles an unconfirmed one as failed. The round is closed, so the engine never
  // looks at it again; the buyer still hears, once.
  it("a failure settled after the round closed is emailed (at once, or on the next tick), and only once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u, { totals: [4200, 3000] });
    // The first times out (placing); the second is never sent and stays held.
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [first] = (
      await held.pg.query("select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank", [r.roundId])
    ).rows;
    // The deadline cancels the held one (its own email) and closes the round with the first still placing.
    await held.pg.query("update concierge.gift_rounds set locked_until = null where id = $1", [r.roundId]);
    await advance(r.roundId, 30);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "ordered" });
    const before = inbox(u).length;

    // Zinc's webhook: it failed. The round ends skipped, and the engine never looks at it again.
    await held.pg.query("select concierge.settle_order($1, $2, 'failed', 'out_of_stock', '{}')", [u.userId, first.id]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    // The webhook tells the buyer at once (orderPlaced → tellOrdered); refused that time...
    held.refuse = true;
    await tellOrdered(r.roundId, engine(dayAt(31)));
    expect(await sends(r.roundId)).not.toContain(`late_fail:${first.id}`);
    held.refuse = false;
    // ...so the tick sends it, once.
    await retryOrderedEmails(engine(dayAt(32)));
    await retryOrderedEmails(engine(dayAt(33)));
    expect(inbox(u).slice(before)).toEqual(["We're sorry, we couldn't buy Mary's gift@32"]);
    const text = mail.filter((m) => m.to === u.email && m.subject.startsWith("We're sorry, we couldn't buy")).map((m) => m.text)[0];
    expect(text).toContain(
      "We know you were counting on the Stoneware mug set for Mary's Christmas on",
    );
    expect(text).toContain("The store ran out. You haven't been charged for it.");
    expect(text).not.toContain("on its way");
  });

  it("an unconfirmed order the owner settles as failed after the deadline is emailed, and the round ends skipped", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, r);
    const [o] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await held.pg.query("select concierge.mark_unconfirmed($1)", [o.id]);
    await advance(r.roundId, 1);
    await advance(r.roundId, 30);
    // Runbook in design/operations.md: Zinc has no such order, so the owner settles it as failed.
    await held.pg.query("select concierge.settle_order($1, $2, 'failed', 'failed', null)", [u.userId, o.id]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    await retryOrderedEmails(engine(dayAt(31)));
    expect(inbox(u).at(-1)).toBe("We're sorry, we couldn't buy Mary's gift@31");
    expect(await sends(r.roundId)).toContain(`late_fail:${o.id}`);
  });

  it("a refused 'ordered' email goes out on the next tick, and never twice", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    await approve(u, r);
    const [o] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await held.pg.query("select concierge.settle_order($1, $2, 'placed', null, '{}')", [u.userId, o.id]);
    held.refuse = true;
    await tellOrdered(r.roundId, engine(dayAt(1)));
    expect(await sends(r.roundId)).not.toContain(`ordered:${o.id}`);
    held.refuse = false;
    await retryOrderedEmails(engine(dayAt(2)));
    await retryOrderedEmails(engine(dayAt(3)));
    expect(inbox(u).filter((m) => m.startsWith("Mary's gift is ordered"))).toEqual(["Mary's gift is ordered@2"]);
  });

  it("emails a failed order at once, keyed by the order (fail:<id>, ALL-116), and only once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await newRound(u);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, [{ status: 400, code: "out_of_stock" }]);
    expect(await approve(u, r)).toEqual({ ok: true, status: "failed", reason: "out_of_stock" });
    await advance(r.roundId, 1);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "out_of_stock" });
    expect(inbox(u)).toEqual(["Sorry, Mary's gift is out of stock@0"]);
    const [o] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    expect(await sends(r.roundId)).toEqual([`fail:${o.id}`]);
  });

  it("with Zinc unreachable all along, says so once on the final hold day", async () => {
    const u = await newUser();
    const r = await approvedRound(u);
    await advance(r.roundId, 27, { zinc: false });
    await advance(r.roundId, 28, { zinc: false });
    await advance(r.roundId, 29, { zinc: false });
    expect(inbox(u)).toEqual(["Sorry, we're having trouble ordering Mary's gift@28"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", attention_reason: "retry" });
  });

  it("the cancel link cancels the held gift, skips the round and releases the list pick (AC-24)", async () => {
    const u = await newUser();
    const owner = await newUser();
    const list = await held.pg.query("insert into lists.lists (owner_id, title) values ($1, 'List') returning id", [owner.userId]);
    const item = await held.pg.query("insert into lists.list_items (list_id, position, name, price_cents) values ($1, 0, 'Vase', 4000) returning id", [list.rows[0].id]);
    const r = await newRound(u, { listItems: [item.rows[0].id] });
    held.zinc.balance = 1000;
    await approve(u, r);
    expect((await held.pg.query("select count(*)::int as n from lists.gift_claims where item_id = $1", [item.rows[0].id])).rows[0].n).toBe(1);

    const [m] = mail.filter((x) => x.to === u.email);
    const token = m.text.match(/Cancel this gift: https:\/\/giftsaf\.test\/a\/(\S+)/)![1];
    const store = createSupabaseNotifyStore(client());
    const result = await confirmActionLink(token, u.userId, { store, now: new Date() });
    expect(result).toMatchObject({
      state: "done",
      done: { title: "Cancelled", body: "We cancelled the gift that was waiting, so nothing was bought or charged for it. Nothing more will be bought for this occasion." },
    });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "skipped" });
    expect(await orderRows(r.roundId)).toEqual([{ status: "cancelled", hold_reason: "funds", failure_type: "cancelled" }]);
    expect((await held.pg.query("select count(*)::int as n from lists.gift_claims where item_id = $1", [item.rows[0].id])).rows[0].n).toBe(0);
    // Someone else's round can't be cancelled through it.
    expect(await store.cancelHeldGift(r.roundId, owner.userId)).toBeNull();
  });

  // N2: the done page says what actually happened.
  it("the cancel link's done page says when the gift was already being ordered and nothing was cancelled", async () => {
    const u = await newUser();
    const r = await newRound(u);
    held.zinc.balance = 1000;
    await approve(u, r);
    const [m] = mail.filter((x) => x.to === u.email);
    const token = m.text.match(/Cancel this gift: https:\/\/giftsaf\.test\/a\/(\S+)/)![1];
    // Topped up, and the next try sent it before the buyer tapped the link.
    held.zinc.balance = 100_000;
    await advance(r.roundId, 1);
    expect(await orderRows(r.roundId)).toEqual([expect.objectContaining({ status: "placing" })]);
    const result = await confirmActionLink(token, u.userId, { store: createSupabaseNotifyStore(client()), now: new Date() });
    expect(result).toMatchObject({
      state: "done",
      done: {
        title: "Already being ordered",
        body: "The gift was already being ordered, so there was nothing left to cancel. We'll email you once the store confirms it.",
      },
    });
    expect(await orderRows(r.roundId)).toEqual([expect.objectContaining({ status: "placing" })]);
  });

});
