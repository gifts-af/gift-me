// A failed gift's ways out besides buying (ALL-185) on the real local database (E5):
// dropFailedOrder under the round's lease, and the skip, which is the hold emails' cancel link
// (cancelHeldGift, cancel_held). The page reads go through a signed-in user's client, so RLS
// applies. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { DbDeps } from "../zinc/types";

vi.mock("server-only", () => ({}));
const { dropFailedOrder, roundView } = await import("../rounds/approval");
const { createSupabaseNotifyStore } = await import("../notify/store");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("a failed gift's ways out (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  let pg: Client;
  const users: string[] = [];
  const deps = (): DbDeps => ({ db: admin!, now: new Date() });

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  type User = { id: string; email: string };
  async function newUser(): Promise<User> {
    const email = `ways-out-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, true)", [data.user.id]);
    return { id: data.user.id, email };
  }

  async function signedIn(u: User) {
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email: u.email, password });
    if (r.error) throw r.error;
    return db;
  }

  /** A round needing attention for failed orders of its first ideas (one per failure), plus a proposed "Mug". */
  async function failedRound(u: User, failures: string[]) {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'Nora', 'friend') returning id", [u.id]);
    const personId = person.rows[0].id as string;
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.id,
      personId,
    ]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now() + interval '1 day', current_date) returning id`,
      [u.id, personId, occasion.rows[0].id],
    );
    const roundId = round.rows[0].id as string;
    const idea = async (title: string, status: string, rank: number) =>
      (
        await pg.query(
          `insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank, source, status)
           values ($1, $2, $3, $4, 2000, 2259, $5, 'generated', $6) returning id`,
          [u.id, roundId, personId, title, rank, status],
        )
      ).rows[0].id as string;
    const orderIds: string[] = [];
    for (const [i, failure] of failures.entries()) {
      const ideaId = await idea(`Mouse pad ${i + 1}`, "selected", i + 1);
      const o = await pg.query(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type, failed_at, ship_to, ship_city, ship_state)
         values ($1, $2, $3, 'zinc_wallet', 2300, 100, 'failed', $4, now(), 'recipient', 'Dayton', 'OH') returning id`,
        [u.id, roundId, ideaId, failure],
      );
      orderIds.push(o.rows[0].id as string);
    }
    const mug = await idea("Mug", "proposed", 10);
    await pg.query("select concierge.reconcile_round($1)", [roundId]);
    return { roundId, orderIds, mug };
  }

  const roundRow = async (roundId: string) =>
    (await pg.query("select status, attention_reason, closed_at, locked_until from concierge.gift_rounds where id = $1", [roundId])).rows[0];

  it("Pick a different gift: the failure is resolved and the round is back to choosing, every other idea buyable", async () => {
    const u = await newUser();
    const r = await failedRound(u, ["price_up"]);
    expect((await roundRow(r.roundId)).status).toBe("needs_attention");

    expect(await dropFailedOrder({ userId: u.id, roundId: r.roundId, orderId: r.orderIds[0] }, deps())).toEqual({ ok: true });

    const row = await roundRow(r.roundId);
    expect(row).toMatchObject({ status: "awaiting_approval", attention_reason: null, closed_at: null, locked_until: null });
    const view = (await roundView(r.roundId, await signedIn(u), new Date()))!;
    expect(view.closedText).toBeNull();
    expect(view.failedOrders).toEqual([]);
    expect(view.ideas.find((i) => i.id === r.mug)?.status).toBe("proposed");
    // Not twice: the round has moved on.
    expect(await dropFailedOrder({ userId: u.id, roundId: r.roundId, orderId: r.orderIds[0] }, deps())).toEqual({ ok: false, error: "not_open" });
  });

  it("refuses with another gift still to fix, and leaves the round as it was", async () => {
    const u = await newUser();
    const r = await failedRound(u, ["price_up", "out_of_stock"]);
    expect(await dropFailedOrder({ userId: u.id, roundId: r.roundId, orderId: r.orderIds[0] }, deps())).toEqual({ ok: false, error: "other_gifts" });
    expect(await roundRow(r.roundId)).toMatchObject({ status: "needs_attention", locked_until: null });
  });

  it("refuses someone else's round", async () => {
    const u = await newUser();
    const other = await newUser();
    const r = await failedRound(u, ["price_up"]);
    expect(await dropFailedOrder({ userId: other.id, roundId: r.roundId, orderId: r.orderIds[0] }, deps())).toEqual({ ok: false, error: "not_found" });
  });

  it("Skip closes the round through the cancel link's path: the untold failure goes to the late email", async () => {
    const u = await newUser();
    const r = await failedRound(u, ["out_of_stock"]);
    const outcome = await createSupabaseNotifyStore(admin!).cancelHeldGift(r.roundId, u.id);
    expect(outcome).toEqual({ cancelled: 0, ordering: 0, onItsWay: 0 });

    const row = await roundRow(r.roundId);
    expect(row.status).toBe("skipped");
    expect(row.closed_at).not.toBeNull();
    const order = (await pg.query("select resolved, failed_after_close from concierge.orders where id = $1", [r.orderIds[0]])).rows[0];
    expect(order).toEqual({ resolved: true, failed_after_close: true });
    const view = (await roundView(r.roundId, await signedIn(u), new Date()))!;
    expect(view.closedText).toBe("This gift round was stopped");
  });
});
