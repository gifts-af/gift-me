// Saving an answer, the answer page's read and the gift history on the real local database (E5):
// the service-role client for the save, and a signed-in user's client for the reads, so RLS is the
// real thing. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database, Rating } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";

vi.mock("server-only", () => ({}));
const { giftHistory, hasPastGifts, reactionView, saveReaction } = await import("../reactions/reactions");
const { SENSITIVE_REFUSAL } = await import("../profile/rules");
const { roundAccess } = await import("../rounds/approval");

const stack = await localStack({ api: true });
const NOW = new Date("2026-03-01T15:00:00Z");

describe.skipIf(!stack)("reactions (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  let pg: Client;
  const users: string[] = [];
  type User = { id: string; db: NonNullable<typeof admin> };
  let buyer: User;
  let other: User;

  async function newUser(): Promise<User> {
    const email = `reactions-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return { id: data.user.id, db };
  }

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    buyer = await newUser();
    other = await newUser();
  });
  afterAll(async () => {
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
    vi.restoreAllMocks();
  });

  const one = async (sql: string, args: unknown[]) => (await pg.query(sql, args)).rows[0];

  type Gift = { title: string; source?: string; status?: string; total?: number | null; failure?: string; resolved?: boolean; refund?: number; again?: boolean };
  type RoundSpec = { status?: string; date?: string; gifts?: Gift[]; kind?: string };
  const newPerson = async (u: User): Promise<string> =>
    (await one("insert into public.people (user_id, name, relationship) values ($1, 'Mary', 'friend') returning id", [u.id])).id;

  async function newRound(u: User, personId: string, o: RoundSpec = {}) {
    const date = o.date ?? "2026-02-20";
    const kind = o.kind ?? "christmas";
    const occasion =
      (await one("select id from concierge.occasions where person_id = $1 and kind = $2 and deleted_at is null", [personId, kind])) ??
      (await one("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, $3) returning id", [u.id, personId, kind]));
    const round = await one(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
       values ($1, $2, $3, $4, $5::date, $5::date - 10, 5000, $6::concierge.round_status) returning id`,
      [u.id, personId, occasion.id, Number(date.slice(0, 4)), date, o.status ?? "delivered"],
    );
    const orderIds: string[] = [];
    let idea: { id: string } | null = null;
    for (const [i, g] of (o.gifts ?? [{ title: "Fly rod" }]).entries()) {
      // `again` is another order of the gift before it.
      if (!g.again || !idea) idea = await one(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank, source, list_item_id)
         values ($1, $2, $3, $4, 4000, 4500, $5, $6, $7) returning id`,
        [u.id, round.id, personId, g.title, i + 1, g.source ?? "generated", g.source === "list" ? randomUUID() : null],
      );
      const status = g.status ?? "delivered";
      const order = await one(
        `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, delivered_at,
                                       failure_type, resolved, total_cents, refund_cents, ship_to, ship_city, ship_state, created_at, hold_reason)
         values ($1, $2, $3, 'zinc_wallet', 4500, 100, $4, $5, $6, $7, $8, $9, 'recipient', 'Dayton', 'OH', now() + $10 * interval '1 second', $11)
         returning id`,
        [
          u.id,
          round.id,
          idea!.id,
          status,
          status === "delivered" ? "2026-02-19T12:00:00Z" : null,
          g.failure ?? null,
          g.resolved ?? false,
          g.total === undefined ? 4321 : g.total,
          g.refund ?? null,
          i,
          status === "held" ? "funds" : null,
        ],
      );
      orderIds.push(order.id);
    }
    return { roundId: round.id as string, personId, occasionId: occasion.id as string, orderIds };
  }
  const fresh = async (o: RoundSpec = {}) => newRound(buyer, await newPerson(buyer), o);

  const save = (orderId: string, rating: string, note: string | null = null, o: { user?: User; now?: Date } = {}) =>
    saveReaction({ userId: (o.user ?? buyer).id, orderId, rating: rating as Rating, note }, { db: admin!, now: o.now ?? NOW });
  const facts = async (personId: string) =>
    (await pg.query("select category, value, source, confirmed, active from concierge.profile_facts where person_id = $1 order by created_at", [personId])).rows;
  const reactions = async (roundId: string) =>
    (await pg.query("select order_id, rating, note from concierge.reactions where round_id = $1 order by created_at", [roundId])).rows;
  const roundStatus = async (id: string) => (await one("select status::text as s from concierge.gift_rounds where id = $1", [id])).s;

  describe("saveReaction", () => {
    it("saves one gift's answer and its fact; the second completes the round (AC-6)", async () => {
      const r = await fresh({ gifts: [{ title: "Fly rod" }, { title: "Reel" }] });
      expect(await save(r.orderIds[0], "loved", "  great cast ")).toEqual({
        ok: true,
        roundId: r.roundId,
        personId: r.personId,
        complete: false,
      });
      expect(await reactions(r.roundId)).toEqual([{ order_id: r.orderIds[0], rating: "loved", note: "great cast" }]);
      expect(await facts(r.personId)).toEqual([
        { category: "loved", value: "Fly rod: great cast", source: "reaction", confirmed: true, active: true },
      ]);
      expect(await roundStatus(r.roundId)).toBe("delivered");
      expect(await save(r.orderIds[1], "liked")).toMatchObject({ ok: true, complete: true });
      expect(await roundStatus(r.roundId)).toBe("complete");
      expect(await facts(r.personId)).toHaveLength(1);
    });

    it("a changed rating replaces its own untouched fact (AC-8)", async () => {
      const r = await fresh();
      await save(r.orderIds[0], "loved");
      expect(await save(r.orderIds[0], "meh", "too long")).toMatchObject({ ok: true });
      expect(await reactions(r.roundId)).toEqual([{ order_id: r.orderIds[0], rating: "meh", note: "too long" }]);
      expect((await facts(r.personId)).map((f) => f.value)).toEqual(["Didn't love: Fly rod: too long"]);
    });

    it("an edited fact stays as the buyer left it (AC-8)", async () => {
      const r = await fresh();
      await save(r.orderIds[0], "loved");
      await pg.query("update concierge.profile_facts set value = 'Rods' where person_id = $1", [r.personId]);
      await save(r.orderIds[0], "liked");
      expect((await facts(r.personId)).map((f) => f.value)).toEqual(["Rods"]);
    });

    it("a turned-off fact stays off (AC-8)", async () => {
      const r = await fresh();
      await save(r.orderIds[0], "loved");
      await pg.query("update concierge.profile_facts set active = false where person_id = $1", [r.personId]);
      await save(r.orderIds[0], "loved", "a note");
      await save(r.orderIds[0], "liked");
      expect(await facts(r.personId)).toEqual([expect.objectContaining({ value: "Fly rod", active: false })]);
    });

    it("an untouched fact follows the note: added, changed and cleared (AC-8)", async () => {
      const r = await fresh();
      const values = async () => (await facts(r.personId)).map((f) => f.value);
      await save(r.orderIds[0], "returned");
      expect(await values()).toEqual([]);
      await save(r.orderIds[0], "returned", "too long");
      expect(await values()).toEqual(["Returned Fly rod: too long"]);
      await save(r.orderIds[0], "returned", "snapped");
      expect(await values()).toEqual(["Returned Fly rod: snapped"]);
      await save(r.orderIds[0], "returned");
      expect(await values()).toEqual([]);
    });

    it("a deleted fact isn't brought back by a note edit (AC-8)", async () => {
      const r = await fresh();
      await save(r.orderIds[0], "loved");
      await pg.query("delete from concierge.profile_facts where person_id = $1", [r.personId]);
      await save(r.orderIds[0], "loved", "a note");
      expect(await facts(r.personId)).toEqual([]);
      expect(await reactions(r.roundId)).toEqual([expect.objectContaining({ note: "a note" })]);
    });

    it("a gift from someone's list keeps the answer and note but makes no fact (AC-17)", async () => {
      const r = await fresh({ gifts: [{ title: "Her listed mug", source: "list" }] });
      for (const rating of ["loved", "meh", "returned"]) {
        expect(await save(r.orderIds[0], rating, "in blue")).toMatchObject({ ok: true });
        expect(await reactions(r.roundId)).toEqual([{ order_id: r.orderIds[0], rating, note: "in blue" }]);
        expect(await facts(r.personId)).toEqual([]);
      }
    });

    it("a sensitive title saves the answer without a fact", async () => {
      const r = await fresh({ gifts: [{ title: "Church architecture book" }] });
      expect(await save(r.orderIds[0], "loved")).toMatchObject({ ok: true });
      expect(await reactions(r.roundId)).toHaveLength(1);
      expect(await facts(r.personId)).toEqual([]);
    });

    it("a sensitive note is refused and nothing is written (AC-9)", async () => {
      const r = await fresh();
      expect(await save(r.orderIds[0], "loved", "good for her diabetes")).toEqual({ ok: false, reason: "sensitive", error: SENSITIVE_REFUSAL });
      expect(await reactions(r.roundId)).toEqual([]);
      expect(await facts(r.personId)).toEqual([]);
    });

    it("counts a line break as one character, however the browser sent it", async () => {
      const r = await fresh();
      // 500 characters with one, 501 as a form posts it.
      expect(await save(r.orderIds[0], "liked", "a\r\n" + "x".repeat(498))).toMatchObject({ ok: true });
      expect((await reactions(r.roundId))[0].note).toBe("a\n" + "x".repeat(498));
    });

    it("refuses an order not delivered, before the occasion, a bad rating and a long note (AC-10)", async () => {
      const r = await fresh({ date: "2026-03-01", gifts: [{ title: "Fly rod" }, { title: "Reel", status: "shipped" }] });
      expect(await save(r.orderIds[1], "loved")).toMatchObject({ ok: false, reason: "not_delivered" });
      expect(await save(r.orderIds[0], "loved", null, { now: new Date("2026-02-28T23:59:59Z") })).toMatchObject({ ok: false, reason: "too_early" });
      expect(await save(r.orderIds[0], "adored")).toMatchObject({ ok: false, reason: "failed" });
      expect(await save(r.orderIds[0], "loved", "x".repeat(501))).toMatchObject({ ok: false, reason: "note_too_long" });
      expect(await reactions(r.roundId)).toEqual([]);
      // The occasion date in UTC is the first day it's open.
      expect(await save(r.orderIds[0], "loved", null, { now: new Date("2026-03-01T00:00:00Z") })).toMatchObject({ ok: true });
    });

    it("someone else's order looks exactly like one that doesn't exist (AC-10)", async () => {
      const r = await fresh();
      const theirs = await save(r.orderIds[0], "loved", null, { user: other });
      expect(theirs).toMatchObject({ ok: false, reason: "not_found" });
      expect(await save(randomUUID(), "loved", null, { user: other })).toEqual(theirs);
      expect(await save("nope", "loved", null, { user: other })).toEqual(theirs);
      expect(await reactions(r.roundId)).toEqual([]);
      expect(await facts(r.personId)).toEqual([]);
    });

    it("a double tap leaves one row and one fact (AC-16)", async () => {
      const r = await fresh();
      const both = await Promise.all([save(r.orderIds[0], "loved"), save(r.orderIds[0], "loved")]);
      expect(both.map((b) => b.ok)).toEqual([true, true]);
      expect(await reactions(r.roundId)).toHaveLength(1);
      expect(await facts(r.personId)).toHaveLength(1);
    });

    it("a removed person's gift saves the answer and no fact", async () => {
      const r = await fresh();
      await pg.query("update public.people set deleted_at = now() where id = $1", [r.personId]);
      expect(await save(r.orderIds[0], "loved")).toMatchObject({ ok: true, complete: true });
      expect(await facts(r.personId)).toEqual([]);
    });
  });

  describe("reactionView", () => {
    it("shows the delivered gifts with their answers, and that answering is open", async () => {
      const r = await fresh({ status: "ordered", gifts: [{ title: "Fly rod" }, { title: "Reel", status: "shipped" }, { title: "Net" }] });
      await save(r.orderIds[2], "meh", "tangled");
      expect(await reactionView(r.roundId, buyer.db, NOW)).toEqual({
        round: {
          id: r.roundId,
          personId: r.personId,
          personName: "Mary",
          occasionKind: "christmas",
          occasionDate: "2026-02-20",
          status: "ordered",
        },
        gifts: [
          { orderId: r.orderIds[0], title: "Fly rod", imageUrl: null, rating: null, note: null },
          { orderId: r.orderIds[2], title: "Net", imageUrl: null, rating: "meh", note: "tangled" },
        ],
        closed: null,
        noteMaxChars: 500,
      });
    });

    it("is closed before the occasion date and open on it (AC-10)", async () => {
      const r = await fresh({ date: "2026-03-02" });
      expect((await reactionView(r.roundId, buyer.db, NOW))?.closed).toBe("too_early");
      expect((await reactionView(r.roundId, buyer.db, new Date("2026-03-02T00:00:00Z")))?.closed).toBeNull();
    });

    it("is null for another account, whose access says other (AC-5)", async () => {
      const r = await fresh();
      expect(await reactionView(r.roundId, other.db, NOW)).toBeNull();
      expect(await reactionView(randomUUID(), other.db, NOW)).toBeNull();
      expect(await reactionView("nope", other.db, NOW)).toBeNull();
      expect(await roundAccess(r.roundId, other.id, { db: admin!, now: NOW })).toBe("other");
    });

    it("survives a removed occasion", async () => {
      const r = await fresh();
      await pg.query("update concierge.occasions set deleted_at = now() where id = $1", [r.occasionId]);
      expect(await reactionView(r.roundId, buyer.db, NOW)).toMatchObject({ round: { occasionKind: null }, closed: null, gifts: [{ title: "Fly rod" }] });
    });
  });

  describe("giftHistory and hasPastGifts", () => {
    it("lists past rounds newest first, with cost, outcome, reaction and note (AC-11)", async () => {
      const personId = await newPerson(buyer);
      const complete = await newRound(buyer, personId, { date: "2024-12-25", gifts: [{ title: "Mug" }] });
      await save(complete.orderIds[0], "loved", "daily");
      const delivered = await newRound(buyer, personId, { date: "2025-12-25", gifts: [{ title: "Vase", total: null }] });
      const skipped = await newRound(buyer, personId, { status: "skipped", date: "2026-01-10", kind: "valentines_day", gifts: [] });
      const storeSkip = await newRound(buyer, personId, {
        status: "skipped",
        date: "2025-06-01",
        kind: "valentines_day",
        gifts: [
          { title: "Lamp", status: "failed", failure: "store_cancelled", resolved: true, refund: 3300 },
          { title: "Rug", status: "failed", failure: "store_cancelled", resolved: true },
          { title: "Pan", status: "failed", failure: "store_cancelled", resolved: true, refund: 0 },
          { title: "Fork", status: "failed", failure: "out_of_stock", resolved: true },
          { title: "Cup", status: "cancelled" },
        ],
      });
      const shipped = await newRound(buyer, personId, { status: "ordered", date: "2026-02-28", gifts: [{ title: "Book", status: "shipped" }] });
      // Not past: on its way for today, and one nothing was bought for yet.
      await newRound(buyer, personId, { status: "ordered", date: "2026-03-01", kind: "mothers_day", gifts: [{ title: "Later", status: "shipped" }] });
      await newRound(buyer, personId, {
        status: "awaiting_approval",
        date: "2025-03-01",
        kind: "mothers_day",
        gifts: [{ title: "No", status: "failed", resolved: true }],
      });

      const rounds = await giftHistory(personId, buyer.db, NOW);
      expect(rounds.map((r) => r.roundId)).toEqual([shipped, skipped, delivered, storeSkip, complete].map((r) => r.roundId));
      expect(rounds[0]).toEqual({
        roundId: shipped.roundId,
        occasionKind: "christmas",
        occasionDate: "2026-02-28",
        status: "ordered",
        gifts: [
          {
            orderId: shipped.orderIds[0],
            title: "Book",
            totalCents: 4321,
            outcome: "on_its_way",
            deliveredAt: null,
            refundCents: null,
            rating: null,
            note: null,
          },
        ],
      });
      expect(rounds[1]).toMatchObject({ status: "skipped", gifts: [] });
      expect(rounds[2].gifts).toEqual([expect.objectContaining({ totalCents: null, outcome: "delivered", deliveredAt: expect.any(String), rating: null })]);
      expect(rounds[3].gifts).toEqual([
        expect.objectContaining({ title: "Lamp", outcome: "store_cancelled", refundCents: 3300 }),
        expect.objectContaining({ title: "Rug", outcome: "store_cancelled", refundCents: null }),
        expect.objectContaining({ title: "Pan", outcome: "store_cancelled", refundCents: null }),
      ]);
      expect(rounds[4]).toMatchObject({ status: "complete", gifts: [{ title: "Mug", rating: "loved", note: "daily" }] });
      expect(await hasPastGifts(personId, buyer.db, NOW)).toBe(true);
    });

    it.each([
      ["unconfirmed", "being_bought"],
      ["held", "being_bought"],
      ["placing", "being_bought"],
      ["placed", "on_its_way"],
      ["failed", "not_bought"],
    ])("a past gift still %s reads %s: never not bought while it may have been", async (status, outcome) => {
      const r = await fresh({ status: "needs_attention", gifts: [{ title: "A", status, total: null }] });
      expect((await giftHistory(r.personId, buyer.db, NOW))[0].gifts).toEqual([expect.objectContaining({ outcome, totalCents: null })]);
    });

    it("a gift bought again after it failed is listed once; after a store cancel, both show", async () => {
      const failed = await fresh({
        gifts: [
          { title: "Mug", status: "failed", failure: "price_up", resolved: true },
          { title: "Mug", again: true },
        ],
      });
      expect((await giftHistory(failed.personId, buyer.db, NOW))[0].gifts).toEqual([
        expect.objectContaining({ orderId: failed.orderIds[1], title: "Mug", outcome: "delivered" }),
      ]);

      const cancelled = await fresh({
        gifts: [
          { title: "Mug", status: "failed", failure: "store_cancelled", resolved: true, refund: 3300 },
          { title: "Mug", again: true },
        ],
      });
      await save(cancelled.orderIds[1], "loved");
      expect((await giftHistory(cancelled.personId, buyer.db, NOW))[0].gifts).toEqual([
        expect.objectContaining({ orderId: cancelled.orderIds[0], outcome: "store_cancelled", refundCents: 3300, rating: null }),
        expect.objectContaining({ orderId: cancelled.orderIds[1], outcome: "delivered", refundCents: null, rating: "loved" }),
      ]);
      expect((await reactionView(cancelled.roundId, buyer.db, NOW))?.gifts.map((g) => g.orderId)).toEqual([cancelled.orderIds[1]]);
    });

    it("keeps a round whose occasion was removed", async () => {
      const r = await fresh();
      await pg.query("update concierge.occasions set deleted_at = now() where id = $1", [r.occasionId]);
      expect(await giftHistory(r.personId, buyer.db, NOW)).toEqual([
        expect.objectContaining({ roundId: r.roundId, occasionKind: null, occasionDate: "2026-02-20" }),
      ]);
      expect(await hasPastGifts(r.personId, buyer.db, NOW)).toBe(true);
    });

    it.each<[RoundSpec, boolean]>([
      [{ status: "delivered" }, true],
      [{ status: "complete" }, true],
      [{ status: "delivered", date: "2026-03-02" }, true],
      [{ status: "complete", date: "2026-03-02" }, true],
      [{ status: "skipped", gifts: [] }, true],
      [{ status: "skipped", date: "2026-02-28", gifts: [] }, true],
      [{ status: "skipped", date: "2026-03-01", gifts: [] }, false],
      [{ status: "skipped", date: "2026-03-02", gifts: [] }, false],
      [{ status: "skipped", date: "2026-03-02", gifts: [{ title: "A", status: "failed", failure: "store_cancelled", resolved: true }] }, false],
      [{ status: "ordered", gifts: [{ title: "A", status: "placed" }] }, true],
      [{ status: "needs_attention", gifts: [{ title: "A", status: "failed", failure: "price_up" }] }, true],
      [{ status: "ordered", date: "2026-03-01", gifts: [{ title: "A", status: "placed" }] }, false],
      [{ status: "awaiting_approval", gifts: [] }, false],
      [{ status: "awaiting_approval", gifts: [{ title: "A", status: "failed", resolved: true }] }, false],
      [{ status: "awaiting_approval", gifts: [{ title: "A", status: "cancelled" }] }, false],
      [{ status: "awaiting_approval", gifts: [{ title: "A", status: "refunded" }] }, false],
    ])("hasPastGifts agrees with the history: %j is %s (AC-11, AC-12)", async (spec, past) => {
      const r = await fresh(spec);
      expect((await giftHistory(r.personId, buyer.db, NOW)).length > 0).toBe(past);
      expect(await hasPastGifts(r.personId, buyer.db, NOW)).toBe(past);
    });

    it("shows another account nothing, and a person with no rounds nothing", async () => {
      const r = await fresh();
      expect(await giftHistory(r.personId, other.db, NOW)).toEqual([]);
      expect(await hasPastGifts(r.personId, other.db, NOW)).toBe(false);
      expect(await giftHistory("nope", buyer.db, NOW)).toEqual([]);
      expect(await hasPastGifts("nope", buyer.db, NOW)).toBe(false);
      expect(await hasPastGifts(await newPerson(buyer), buyer.db, NOW)).toBe(false);
    });
  });
});
