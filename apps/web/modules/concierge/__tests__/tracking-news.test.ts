import { addDays } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { createSupabaseRoundStore } from "../rounds/store";
import { runTrackingNews } from "../tracking/news";
import { heldRounds, type User } from "./round-engine-held";
import { BASE, captureLog, named } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// The daily news summary (ALL-33 AC-4 to AC-7, AC-6a, AC-6b, AC-9, AC-15): the real news run, the
// real round store and the real local database (E5); only Zinc and the email service are faked.
// Each run's candidates are scoped to one test's user (ownStaleOrders), so the shared database's
// other orders, and this file's earlier tests, are never told.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("the daily news summary (real local database)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, approve, newUser, newRound, sends, inbox } = held;

  /** A Christmas round (occasion on day 40, ship-by day 30) with its first gift bought and placed with Zinc. */
  async function placedRound(u: User, o: { totals?: number[]; title?: string } = {}) {
    const r = await newRound(u, { totals: o.totals ?? [4200] });
    if (o.title) await held.pg.query("update concierge.gift_ideas set title = $2 where id = $1", [r.ideaIds[0], o.title]);
    await held.pg.query("update concierge.gift_ideas set retailer = 'walmart' where round_id = $1", [r.roundId]);
    held.zinc.plan.set(`https://shop.test/p/${r.ideaIds[0]}`, ["timeout"]);
    await approve(u, { roundId: r.roundId, ideaIds: [r.ideaIds[0]] });
    const orderId = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows[0].id as string;
    await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where id = $1", [orderId]);
    await held.pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', $3::jsonb)", [
      u.userId,
      orderId,
      JSON.stringify({ provider_order_id: crypto.randomUUID(), total_cents: 3450 }),
    ]);
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    return { ...r, orderId };
  }

  let eventAt = Date.now();
  /** Zinc's estimate for the order, `n` days from today, as the webhook saves it. */
  async function estimate(u: User, orderId: string, n: number, o: { shipped?: boolean } = {}) {
    eventAt += 60_000;
    await held.pg.query("select concierge.record_tracking($1, $2, $3, '[]'::jsonb, current_date + $4::int, $5)", [
      u.userId,
      orderId,
      o.shipped ?? true,
      n,
      new Date(eventAt).toISOString(),
    ]);
  }

  const settingFromDb = async (key: string) =>
    Number((await held.pg.query("select value from concierge.app_settings where key = $1", [key])).rows[0].value);

  /**
   * The news run on day `n` for `u`'s orders, wired as the tick does it. `setting` stands in for
   * the settings, so late_check_enabled can be off without touching the shared row.
   */
  function news(u: User, n: number, o: { setting?: (key: string) => Promise<number> } = {}) {
    const { engine } = wiring(dayAt(n));
    return runTrackingNews({
      store: createSupabaseRoundStore(ownStaleOrders(held.client(), [u.userId])),
      notify: engine.notify,
      today: addDays(held.today, n),
      setting: o.setting ?? settingFromDb,
    });
  }
  const lateCheckOff = async (key: string) => (key === "late_check_enabled" ? 0 : settingFromDb(key));

  const lastText = (u: User) => mail.filter((m) => m.to === u.email).at(-1)!.text;

  // ─── Late and on time ───

  it("late shipped gift is told once, with the arrived button (AC-4)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u);
    await estimate(u, r.orderId, 42);
    const before = inbox(u).length;
    expect(await news(u, 1)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Mary's gift may arrive after Christmas@1"]);
    const text = lastText(u);
    expect(text).toContain(`is now expected ${expectedText(42)}, two days late.`);
    expect(text).toContain("It's already on its way, so it can't be cancelled.");
    expect(text).toContain(`It already arrived: ${BASE}/rounds/${r.roundId}`);
    expect(await sends(r.roundId)).toContain(`late:${r.orderId}`);
    expect(await news(u, 2)).toEqual({ sent: 0 });
    expect(inbox(u).slice(before)).toHaveLength(1);
    expect(named("tracking.news_sent").at(-1)).toMatchObject({ user_id: u.userId, items: 1 });
  });

  it("late placed gift without estimate is told without the button (AC-5)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u);
    // The store's own range ends after the occasion (placed today + 40 + 5 = day 45).
    await held.pg.query("update concierge.gift_ideas set handling_days_max = 40 where id = $1", [r.ideaIds[0]]);
    const before = inbox(u).length;
    expect(await news(u, 1)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Mary's gift may arrive after Christmas@1"]);
    const text = lastText(u);
    expect(text).toContain(`is now expected ${expectedText(45)}, five days late.`);
    expect(text).not.toContain("It already arrived");
    expect(await news(u, 2)).toEqual({ sent: 0 });
  });

  it("back on time after late is told once (AC-6)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u);
    await estimate(u, r.orderId, 42);
    await news(u, 1);
    const before = inbox(u).length;
    await estimate(u, r.orderId, 39);
    expect(await news(u, 2)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Good news: Mary's gift is back on time@2"]);
    expect(lastText(u)).toContain(`is now expected ${expectedText(39)}, in time for Mary's Christmas`);
    expect(await sends(r.roundId)).toContain(`ontime:${r.orderId}`);
    expect(await news(u, 3)).toEqual({ sent: 0 });
    // Late again after the good news: never told twice.
    await estimate(u, r.orderId, 43);
    expect(await news(u, 4)).toEqual({ sent: 0 });
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("nothing after the occasion (AC-7)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u);
    await estimate(u, r.orderId, 42);
    expect(await news(u, 41)).toEqual({ sent: 0 });
    expect(inbox(u).filter((s) => s.includes("may arrive"))).toEqual([]);
    expect(await sends(r.roundId)).not.toContain(`late:${r.orderId}`);
  });

  // ─── Grouping ───

  it("two late gifts on two rounds plus one on time make one summary, bad news first (AC-6a)", async () => {
    const u = await newUser({ autoTopUp: null });
    const a = await placedRound(u, { title: "Cozy throw blanket" });
    const b = await placedRound(u, { title: "Reading lamp" });
    const c = await placedRound(u, { title: "Tea sampler" });
    // c was told late before; now it's back on time.
    await estimate(u, c.orderId, 42);
    await news(u, 1);
    await estimate(u, c.orderId, 38);
    await estimate(u, a.orderId, 42);
    await estimate(u, b.orderId, 41, { shipped: false });
    const before = inbox(u).length;
    expect(await news(u, 2)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Updates on 3 of your gifts@2"]);
    const text = lastText(u);
    expect(text).toContain("We're sorry, two of your gifts have bad news. One has good news.");
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.map((l) => l.replace(/ \(.*$/, ""))).toEqual([
      "- Cozy throw blanket may arrive late",
      "- Reading lamp may arrive late",
      "- Good news: the Tea sampler is back on time",
    ]);
    // Only the shipped late gift has the arrived link.
    expect(text.match(/It already arrived: /g)).toHaveLength(1);
    expect(text).toContain(`It already arrived: ${BASE}/rounds/${a.roundId}`);
    expect(await sends(a.roundId)).toContain(`late:${a.orderId}`);
    expect(await sends(b.roundId)).toContain(`late:${b.orderId}`);
    expect(await sends(c.roundId)).toContain(`ontime:${c.orderId}`);
    expect(named("tracking.news_sent").at(-1)).toMatchObject({ user_id: u.userId, items: 3 });
    expect(await news(u, 3)).toEqual({ sent: 0 });
  });

  it("refused summary releases every claimed key across rounds (AC-6b)", async () => {
    const u = await newUser({ autoTopUp: null });
    const a = await placedRound(u);
    const b = await placedRound(u);
    await estimate(u, a.orderId, 42);
    await estimate(u, b.orderId, 43);
    const before = inbox(u).length;
    held.refuseTo.add(u.email);
    try {
      expect(await news(u, 1)).toEqual({ sent: 0 });
    } finally {
      held.refuseTo.delete(u.email);
    }
    expect(await sends(a.roundId)).not.toContain(`late:${a.orderId}`);
    expect(await sends(b.roundId)).not.toContain(`late:${b.orderId}`);
    expect(named("tracking.news_failed").at(-1)).toMatchObject({ user_id: u.userId, alert: true });
    expect(await news(u, 2)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Updates on 2 of your gifts@2"]);
  });

  // ─── Switches and cancels ───

  /** A store cancel on or after the round's ship-by day: resolved at once, told only by the news run (AC-9). */
  async function lateCancel(u: User) {
    const r = await placedRound(u);
    await held.pg.query("select concierge.store_cancel_order($1, $2, current_date + 30)", [u.userId, r.orderId]);
    return r;
  }

  it("late_check_enabled = 0 sends no late or on-time news but still tells a late store cancel (AC-15)", async () => {
    const u = await newUser({ autoTopUp: null });
    const late = await placedRound(u);
    await estimate(u, late.orderId, 42);
    const cancelled = await lateCancel(u);
    const before = inbox(u).length;
    expect(await news(u, 31, { setting: lateCheckOff })).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@31"]);
    expect(await sends(late.roundId)).not.toContain(`late:${late.orderId}`);
    expect(await sends(cancelled.roundId)).toContain(`cancel_late:${cancelled.orderId}`);
  });

  it("a late_check_enabled that can't be read is logged and skipped; cancel news still goes out", async () => {
    const u = await newUser({ autoTopUp: null });
    const late = await placedRound(u);
    await estimate(u, late.orderId, 42);
    await lateCancel(u);
    const result = await news(u, 31, {
      setting: async (key) => {
        throw new Error(`Setting ${key} is missing.`);
      },
    });
    expect(result).toEqual({ sent: 1 });
    expect(inbox(u).at(-1)).toBe("Sorry, the store cancelled Mary's gift@31");
    expect(named("tracking.late_check_unreadable").length).toBeGreaterThan(0);
  });

  it("cancel_late is told once with the store-cancelled wording and no button (AC-9)", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await lateCancel(u);
    const before = inbox(u).length;
    expect(await news(u, 31)).toEqual({ sent: 1 });
    expect(inbox(u).slice(before)).toEqual(["Sorry, the store cancelled Mary's gift@31"]);
    const text = lastText(u);
    expect(text).toContain("We're sorry. Walmart cancelled the Stoneware mug set for Mary's Christmas");
    expect(text).toContain("The $34.50 is back in your Zinc wallet.");
    expect(text).toContain("It's too late for us to ship another gift in time.");
    expect(text).not.toContain("http");
    expect(await sends(r.roundId)).toContain(`cancel_late:${r.orderId}`);
    expect(await news(u, 32)).toEqual({ sent: 0 });
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  /** "Sat, Mar 14" for day `n`, as the emails write dates. */
  function expectedText(n: number): string {
    const d = new Date(`${addDays(held.today, n)}T00:00:00Z`);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
    const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
    return `${wd}, ${mo} ${d.getUTCDate()}`;
  }
});
