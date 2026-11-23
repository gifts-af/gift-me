import { describe, expect, it, vi } from "vitest";
import { localStack, ownStaleOrders } from "../../../test/local-db";
import { createSupabaseRoundStore } from "../rounds/store";
import { retryDeliveredEmails, tellDelivered } from "../tracking/delivered";
import { heldRounds, type User } from "./round-engine-held";
import { BASE, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// The delivered email (ALL-33 AC-11, AC-13): the real tellDelivered and retry, the real round
// store and the real local database (E5); only Zinc and the email service are faked. The retry's
// query is scoped to this file's users (ownStaleOrders), so the shared database's other rounds
// are never told.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("the delivered email (real local database)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, dayAt, wiring, approve, newUser, newRound, sends, inbox } = held;

  /** A round whose first `n` gifts are bought and placed with Zinc. Order ids in rank order. */
  async function placedRound(u: User, n = 1) {
    const r = await newRound(u, { totals: n === 2 ? [4200, 3000] : [4200] });
    for (const id of r.ideaIds) held.zinc.plan.set(`https://shop.test/p/${id}`, ["timeout"]);
    await approve(u, r);
    await held.pg.query("update concierge.orders set status = 'placing', hold_reason = null where round_id = $1 and status = 'held'", [r.roundId]);
    const rows = await held.pg.query(
      "select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id where o.round_id = $1 order by i.rank",
      [r.roundId],
    );
    const orderIds = rows.rows.map((x) => x.id as string);
    for (const orderId of orderIds) {
      await held.pg.query("select concierge.settle_order($1, $2, 'placed', 'failed', $3::jsonb)", [
        u.userId,
        orderId,
        JSON.stringify({ provider_order_id: crypto.randomUUID(), total_cents: 3450 }),
      ]);
    }
    await held.pg.query("select concierge.reconcile_round($1)", [r.roundId]);
    return { ...r, orderIds };
  }
  const deliver = (u: User, orderId: string) => held.pg.query("select concierge.mark_delivered($1, $2, 'zinc')", [u.userId, orderId]);
  const roundStatus = async (roundId: string) =>
    (await held.pg.query("select status::text as s from concierge.gift_rounds where id = $1", [roundId])).rows[0].s as string;
  const deps = () => {
    const { engine } = wiring(dayAt(1));
    return { store: createSupabaseRoundStore(ownStaleOrders(held.client(), held.users)), notify: engine.notify };
  };
  const lastText = (u: User) => mail.filter((m) => m.to === u.email).at(-1)!.text;

  it("delivered email names every gift and is sent once", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u, 2);
    await deliver(u, r.orderIds[0]);
    await deliver(u, r.orderIds[1]);
    expect(await roundStatus(r.roundId)).toBe("delivered");
    const before = inbox(u).length;
    expect(await tellDelivered(r.roundId, deps())).toBe("sent");
    expect(inbox(u).slice(before)).toEqual(["Mary's gift was delivered@1"]);
    const text = lastText(u);
    expect(text).toContain("Everything you chose for Mary's Christmas on");
    expect(text).toContain("Stoneware mug set");
    expect(text).toContain("Linen apron");
    expect(text.match(/Delivered \w+, \w+ \d+/g)).toHaveLength(2);
    expect(text).toContain(`See Mary's gift: ${BASE}/rounds/${r.roundId}`);
    expect(text).toContain("after the occasion we'll ask how they liked it.");
    expect(await sends(r.roundId)).toContain("delivered");
    // Told once: the same call again, and the tick's retry, send nothing.
    expect(await tellDelivered(r.roundId, deps())).toBe("none");
    await retryDeliveredEmails(deps());
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("refused delivered email is retried by the next tick", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u);
    await deliver(u, r.orderIds[0]);
    const before = inbox(u).length;
    held.refuse = true;
    expect(await tellDelivered(r.roundId, deps())).toBe("refused");
    held.refuse = false;
    expect(inbox(u).slice(before)).toEqual([]);
    expect(await sends(r.roundId)).not.toContain("delivered");
    await retryDeliveredEmails(deps());
    expect(inbox(u).slice(before)).toEqual(["Mary's gift was delivered@1"]);
    expect(await sends(r.roundId)).toContain("delivered");
    await retryDeliveredEmails(deps());
    expect(inbox(u).slice(before)).toHaveLength(1);
  });

  it("round with one gift still shipped gets no delivered email", async () => {
    const u = await newUser({ autoTopUp: null });
    const r = await placedRound(u, 2);
    await held.pg.query("update concierge.orders set status = 'shipped' where id = $1", [r.orderIds[1]]);
    await deliver(u, r.orderIds[0]);
    expect(await roundStatus(r.roundId)).not.toBe("delivered");
    const before = inbox(u).length;
    expect(await tellDelivered(r.roundId, deps())).toBe("none");
    await retryDeliveredEmails(deps());
    expect(inbox(u).slice(before)).toEqual([]);
    expect(await sends(r.roundId)).not.toContain("delivered");
  });
});
