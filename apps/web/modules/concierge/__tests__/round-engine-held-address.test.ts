import { describe, expect, it, vi } from "vitest";
import { localStack } from "../../../test/local-db";
import { tellOrdered, tellOwnerOfRejection, tellOwnersOfRejections } from "../rounds/money-path";
import { createSupabaseIdeaStore } from "../ideas/store";
import { createSupabaseRoundStore } from "../rounds/store";
import { heldRounds, type User } from "./round-engine-held";
import { captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Held rounds: list-only people, whether a round has an address, and shared addresses.

captureLog();

const stack = await localStack({ api: true });

describe.skipIf(!stack)("held rounds: lists and addresses (real local database, fake Zinc)", () => {
  const held = heldRounds(stack?.supabase ?? null);
  const { mail, refuseTo, client, dayAt, engine, advance, approve, newUser, newRound, orderRows, sends, textFor } = held;

  // ─── a round for a person with only a list (ALL-29 AC-28) ─────────────────

  describe("hasListGifts (ALL-29 AC-28)", () => {
    /** A generating round with no ideas, its person linked to a list owned by someone else. */
    async function listRound() {
      const u = await newUser({ connected: false });
      const r = await newRound(u);
      await held.pg.query("delete from concierge.gift_ideas where round_id = $1", [r.roundId]);
      await held.pg.query("update concierge.gift_rounds set status = 'generating' where id = $1", [r.roundId]);
      const personId = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].person_id as string;
      const owner = await newUser({ connected: false });
      const list = await held.pg.query("insert into lists.lists (owner_id, title) values ($1, 'Wishes') returning id, share_token", [owner.userId]);
      await held.pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
        personId,
        u.userId,
        list.rows[0].id,
        list.rows[0].share_token,
      ]);
      const item = (
        await held.pg.query(
          "insert into lists.list_items (list_id, position, name, price_cents, product_url) values ($1, 0, 'Vase', 2500, 'https://shop.example/vase') returning id",
          [list.rows[0].id],
        )
      ).rows[0].id as string;
      const both = async () => ({
        hasListGifts: (await createSupabaseRoundStore(client()).roundContext(r.roundId)).hasListGifts,
        listGifts: (await createSupabaseIdeaStore(client()).inputs({ userId: u.userId, personId, roundId: r.roundId }))?.listGifts.length,
      });
      return { owner, item, both };
    }

    it("hasListGifts and the run's listGifts agree for a claimed-only list", async () => {
      const { owner, item, both } = await listRound();
      expect(await both()).toEqual({ hasListGifts: true, listGifts: 1 });

      await held.pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name) values ($1, $2, 'Bea')", [item, owner.userId]);
      expect(await both()).toEqual({ hasListGifts: false, listGifts: 0 });
    });
  });

  // ─── a list owner's shared address (ALL-112, T61) ─────────────────────────

  describe("whether a round has an address (ALL-63)", () => {
    const hasAddress = async (roundId: string) => {
      await held.pg.query("update concierge.gift_rounds set status = 'needs_address' where id = $1", [roundId]);
      return (await createSupabaseRoundStore(client()).roundContext(roundId)).hasAddress;
    };
    const personOf = async (roundId: string) =>
      (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id as string;
    const clearOwnEntry = async (roundId: string) =>
      held.pg.query("update public.people set address_line1 = null, city = null, state = null, zip = null where id = $1", [await personOf(roundId)]);

    it("a shared address counts when the buyer has none (AC-16)", async () => {
      const u = await newUser();
      const r = await newRound(u);
      await clearOwnEntry(r.roundId);
      await shareWith(r, u);
      expect(await hasAddress(r.roundId)).toBe(true);
    });

    it("with sharing off or the link revoked, it doesn't (AC-17)", async () => {
      const u = await newUser();
      const off = await newRound(u);
      await clearOwnEntry(off.roundId);
      const owner = await shareWith(off, u);
      await held.pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);
      expect(await hasAddress(off.roundId)).toBe(false);

      const revoked = await newRound(u);
      await clearOwnEntry(revoked.roundId);
      const other = await shareWith(revoked, u);
      await held.pg.query("update lists.lists set share_token = gen_random_uuid() where owner_id = $1", [other.userId]);
      expect(await hasAddress(revoked.roundId)).toBe(false);
    });

    it("a malformed shared row alone decides, even with a good entry of the buyer's (AC-18)", async () => {
      const u = await newUser();
      const r = await newRound(u);
      const owner = await shareWith(r, u);
      await held.pg.query("update public.account_addresses set state = 'Ohio' where user_id = $1", [owner.userId]);
      expect(await hasAddress(r.roundId)).toBe(false);
    });

    it("a failed read of the shared address can't hold up a round that doesn't need it", async () => {
      const u = await newUser();
      const r = await newRound(u);
      await held.pg.query("update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'funds' where id = $1", [r.roundId]);
      const real = client();
      const broken = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== "rpc") return Reflect.get(target, prop, receiver);
          return () => Promise.resolve({ data: null, error: { code: "XX000", message: "down" } });
        },
      });
      await expect(createSupabaseRoundStore(broken).roundContext(r.roundId)).resolves.toMatchObject({ hasAddress: true, hasSharedAddress: false });
    });

    it("with nothing shared, the buyer's own entry counts as before", async () => {
      const u = await newUser();
      const r = await newRound(u);
      expect(await hasAddress(r.roundId)).toBe(true);
    });
  });

  const WITHDRAWN = "we can't use the address Mary was sharing, so we didn't buy the Stoneware mug set and you haven't been charged for it.";
  const REJECTED = "the store couldn't use the address Mary saved, so we didn't buy the Stoneware mug set and you haven't been charged for it.";
  const ASKED = "We'll ask Mary to check it, without mentioning a gift.";

  /** A list owner sharing an address, and the round's person linked through their current share link. */
  async function shareWith(r: { roundId: string }, buyer: User): Promise<User> {
    const owner = await newUser();
    await held.pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
       values ($1, 'Sam', 'Rivera', '44 Shared St', 'Akron', 'OH', '44301', true)`,
      [owner.userId],
    );
    const list = await held.pg.query("insert into lists.lists (owner_id, title) values ($1, 'Birthday') returning id, share_token", [owner.userId]);
    const person = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [r.roundId])).rows[0].person_id;
    await held.pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      person,
      buyer.userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);
    await held.pg.query("update public.people set linked_user_id = $2 where id = $1", [person, owner.userId]);
    return owner;
  }
  /** The buyer approves against the shared address, and the order goes to Zinc. */
  async function placedToShared(u: User, o: { totals?: number[] } = {}) {
    const r = await newRound(u, o);
    const owner = await shareWith(r, u);
    await approve(u, r);
    // In the ideas' order: orders made in one transaction share created_at, so it can't order them.
    const rows = await held.pg.query(
      `select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
        where o.round_id = $1 and o.status = 'placing' order by i.rank`,
      [r.roundId],
    );
    return { ...r, owner, orderIds: rows.rows.map((x) => x.id as string) };
  }
  const zincRejects = (u: User, orderId: string) =>
    held.pg.query("select concierge.settle_order($1, $2, 'failed', 'invalid_shipping_address', null)", [u.userId, orderId]);
  const snapshots = async (roundId: string) =>
    (
      await held.pg.query(
        "select count(*)::int as n from concierge.order_addresses x join concierge.orders o on o.id = x.order_id where o.round_id = $1 and o.failure_type = 'address_rejected'",
        [roundId],
      )
    ).rows[0].n;

  it("a gift held for an address goes to a shared address that arrives, with no email to fix it (ALL-63 AC-7)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await approve(u, r);
    const [first] = (await held.pg.query("select id from concierge.orders where round_id = $1", [r.roundId])).rows;
    await zincRejects(u, first.id);
    expect((await orderRows(r.roundId)).map((o) => o.hold_reason)).toContain("address");
    await shareWith(r, u);
    held.zinc.posts = [];

    await advance(r.roundId, 1);

    expect(held.zinc.posts).toEqual([expect.objectContaining({ city: "Akron" })]);
    expect(mail.filter((m) => m.to === u.email && /address/i.test(m.subject))).toEqual([]);
    const source = await held.pg.query("select address_source from concierge.orders where round_id = $1 and status = 'placing'", [r.roundId]);
    expect(source.rows).toEqual([{ address_source: "shared" }]);
  });

  it("sharing stopped after approval: the buyer is told once, and nothing is bought (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    const lock = (await held.pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    await held.pg.query("select concierge.approve_round($1, $2, $3, $4)", [
      r.roundId,
      u.userId,
      lock,
      JSON.stringify([
        {
          idea_id: r.ideaIds[0],
          max_price_cents: 4520,
          fee_cents: 100,
          ship_to: "recipient",
          address_source: "shared",
          address_owner_id: owner.userId,
          address: { recipient_first_name: "Sam", recipient_last_name: "Rivera", address_line1: "44 Shared St", city: "Akron", state: "OH", zip: "44301", country: "US" },
        },
      ]),
    ]);
    await held.pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
    await held.pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);

    await advance(r.roundId, 1);
    await advance(r.roundId, 2);

    expect(held.zinc.posts).toEqual([]);
    expect(textFor(u)).toEqual([expect.stringContaining(WITHDRAWN)]);
    expect(textFor(owner)).toEqual([]);
  });

  it("Zinc rejected a shared address: the owner is asked first, neutrally, then the buyer is told (AC-9, AC-10, AC-12)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);

    await advance(roundId, 1);
    await advance(roundId, 2);

    const order = mail.map((m) => m.to);
    expect(order.indexOf(owner.email)).toBeLessThan(order.indexOf(u.email));
    expect(textFor(u)).toEqual([expect.stringContaining(`${REJECTED} ${ASKED}`)]);
    const [ownerEmail] = mail.filter((m) => m.to === owner.email);
    expect(mail.filter((m) => m.to === owner.email)).toHaveLength(1);
    expect(ownerEmail.subject).toBe("Please check your saved address");
    expect(ownerEmail.text).toContain("Please check your saved address is current. It's used if someone sends you a gift through your list.");
    for (const secret of ["Mary", "Stoneware", u.email, roundId]) expect(ownerEmail.text).not.toContain(secret);
    const rows = await held.pg.query("select round_id from concierge.notifications where user_id = $1", [owner.userId]);
    expect(rows.rows).toEqual([{ round_id: null }]);
    const links = await held.pg.query("select round_id, action from concierge.action_links where user_id = $1", [owner.userId]);
    expect(links.rows).toEqual([{ round_id: null, action: "check_my_address" }]);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("two picks rejected: one email to the owner, and the buyer's names both (AC-9, AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u, { totals: [2000, 2000] });
    for (const id of orderIds) await zincRejects(u, id);

    await advance(roundId, 1);

    expect(mail.filter((m) => m.to === owner.email)).toHaveLength(1);
    const [text] = textFor(u);
    expect(textFor(u)).toHaveLength(1);
    expect(text).toContain("the Stoneware mug set");
    expect(text).toContain("the Linen apron");
    expect(text).toContain("You haven't been charged for either.");
  });

  it("the owner already changed the address: no email to them, and the buyer isn't promised one (AC-11, AC-13)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await held.pg.query("update public.account_addresses set address_line2 = 'Apt 3' where user_id = $1", [owner.userId]);

    await advance(roundId, 1);

    expect(textFor(owner)).toEqual([]);
    expect(textFor(u)[0]).toContain(REJECTED);
    expect(textFor(u)[0]).not.toContain(ASKED);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a refused email to the owner doesn't stop the buyer's, and the tick tries again (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    refuseTo.add(owner.email);

    await advance(roundId, 1);
    expect(textFor(u)[0]).toContain(`${REJECTED} ${ASKED}`);
    expect(textFor(owner)).toEqual([]);
    expect(await snapshots(roundId)).toBe(1);

    refuseTo.delete(owner.email);
    await tellOwnersOfRejections(engine(dayAt(2)));
    await tellOwnersOfRejections(engine(dayAt(3)));
    expect(textFor(owner)).toHaveLength(1);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a rejection after the round closed still tells the owner, once, with the buyer's late email (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await held.pg.query("select concierge.cancel_held($1, 'deadline')", [roundId]);
    await zincRejects(u, orderIds[0]);

    await tellOrdered(roundId, engine(dayAt(1)));
    await tellOwnersOfRejections(engine(dayAt(1)));
    await tellOrdered(roundId, engine(dayAt(2)));
    await tellOwnersOfRejections(engine(dayAt(2)));

    expect(textFor(owner)).toHaveLength(1);
    expect(mail.filter((m) => m.to === u.email).map((m) => m.subject)).toEqual([expect.stringContaining("we couldn't buy")]);
  });

  it("a price failure already open doesn't hide the address email (AC-9)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u, { totals: [2000, 2000] });
    await held.pg.query("select concierge.settle_order($1, $2, 'failed', 'price_up', null)", [u.userId, orderIds[0]]);
    await advance(roundId, 1);
    await zincRejects(u, orderIds[1]);
    await advance(roundId, 2);

    const texts = textFor(u);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain("the store couldn't use the address Mary saved, so we didn't buy the Linen apron");
  });

  it("a pick still placing isn't said to be free when another ends (AC-16)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u, { totals: [2000, 2000] });
    await zincRejects(u, orderIds[1]);
    await advance(roundId, 1);
    expect(textFor(u)[0]).toContain("didn't buy the Linen apron and you haven't been charged for it.");
    expect(textFor(u)[0]).not.toContain("Stoneware");
  });

  it("sharing stopped with two picks: one email, naming both (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u, { totals: [2000, 2000] });
    const owner = await shareWith(r, u);
    const lock = (await held.pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    await held.pg.query("select concierge.approve_round($1, $2, $3, $4)", [
      r.roundId,
      u.userId,
      lock,
      JSON.stringify(
        r.ideaIds.map((id) => ({
          idea_id: id,
          max_price_cents: 2100,
          fee_cents: 100,
          ship_to: "recipient",
          address_source: "shared",
          address_owner_id: owner.userId,
          address: { recipient_first_name: "Sam", recipient_last_name: "Rivera", address_line1: "44 Shared St", city: "Akron", state: "OH", zip: "44301", country: "US" },
        })),
      ),
    ]);
    await held.pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
    await held.pg.query("update public.account_addresses set share_for_gifts = false where user_id = $1", [owner.userId]);
    const log = vi.spyOn(console, "log");
    try {
      await advance(r.roundId, 1);
      const lines = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("order.address_withdrawn");
      for (const secret of ["44 Shared St", "Rivera", "Akron", owner.userId]) expect(lines).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
    expect(held.zinc.posts).toEqual([]);
    const [text] = textFor(u);
    expect(textFor(u)).toHaveLength(1);
    expect(text).toContain("the Stoneware mug set");
    expect(text).toContain("the Linen apron");
    expect(text).toContain("You haven't been charged for either.");
  });

  it("the person now links someone else: neither owner is emailed (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const person = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id;
    await held.pg.query("delete from lists.person_links where person_id = $1", [person]);
    const other = await shareWith({ roundId }, u);
    await held.pg.query("update public.account_addresses set address_line1 = '9 Other Rd' where user_id = $1", [other.userId]);

    await advance(roundId, 1);

    expect(textFor(owner)).toEqual([]);
    expect(textFor(other)).toEqual([]);
    expect(textFor(u)[0]).not.toContain(ASKED);
  });

  it("an owner with no email address is ruled out (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await held.pg.query("update auth.users set email = null where id = $1", [owner.userId]);

    await advance(roundId, 1);

    expect(textFor(u)[0]).not.toContain(ASKED);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("a failed lookup isn't ruled out: nothing is cleared, and the buyer isn't promised an ask (AC-11)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const deps = engine(dayAt(1));
    const broken = { ...deps, store: { ...deps.store, sharedAddressOwnerToTell: async () => { throw new Error("down"); } } };

    expect(await tellOwnerOfRejection(roundId, broken)).toBe("retry");
    expect(await snapshots(roundId)).toBe(1);
  });

  it("the buyer cancelled the round: the tick still tells the owner (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    await held.pg.query("select concierge.cancel_held($1, 'cancel')", [roundId]);

    await tellOwnersOfRejections(engine(dayAt(1)));

    expect(textFor(owner)).toHaveLength(1);
    expect(await snapshots(roundId)).toBe(0);
  });

  it("an email kept being refused: after the retry window it gives up and deletes the address (AC-10, AC-13)", async () => {
    const u = await newUser();
    const { roundId, orderIds, owner } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    refuseTo.add(owner.email);

    await tellOwnersOfRejections(engine(dayAt(2)));
    expect(await snapshots(roundId)).toBe(1);

    const log = vi.spyOn(console, "log");
    try {
      await tellOwnersOfRejections(engine(dayAt(8)));
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("order.shared_address_notice_abandoned");
    } finally {
      log.mockRestore();
    }
    expect(await snapshots(roundId)).toBe(0);
    expect(await sends(roundId)).not.toContain("shared_address");
    expect(textFor(owner)).toEqual([]);
  });

  it("two runs racing: the one that loses leaves the address, so a refused send can be tried again (AC-10)", async () => {
    const u = await newUser();
    const { roundId, orderIds } = await placedToShared(u);
    await zincRejects(u, orderIds[0]);
    const deps = engine(dayAt(1));
    const lost = { ...deps, store: { ...deps.store, recordSend: async () => false } };

    expect(await tellOwnerOfRejection(roundId, lost)).toBe("asked");
    expect(await snapshots(roundId)).toBe(1);
  });

  it("logs ids only, with no address, name or owner in the buyer's round events (AC-15)", async () => {
    const log = vi.spyOn(console, "log");
    try {
      const u = await newUser();
      const { roundId, orderIds, owner } = await placedToShared(u);
      await zincRejects(u, orderIds[0]);
      await advance(roundId, 1);
      const lines = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("order.shared_address_notice");
      for (const secret of ["44 Shared St", "Rivera", "Akron", owner.userId, owner.email]) expect(lines).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  // ─── relinked to another list owner before placing ─────────────────────

  /** Approved to the current owner's shared address, then "crashed" before placing: held/retry, lease given back. */
  async function approvedToShared(u: User, r: { roundId: string; ideaIds: string[] }, owner: User) {
    const lock = (await held.pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    await held.pg.query("select concierge.approve_round($1, $2, $3, $4)", [
      r.roundId,
      u.userId,
      lock,
      JSON.stringify([
        {
          idea_id: r.ideaIds[0],
          max_price_cents: 4520,
          fee_cents: 100,
          ship_to: "recipient",
          address_source: "shared",
          address_owner_id: owner.userId,
          address: { recipient_first_name: "Sam", recipient_last_name: "Rivera", address_line1: "44 Shared St", city: "Akron", state: "OH", zip: "44301", country: "US" },
        },
      ]),
    ]);
    await held.pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);
  }
  /** Cuts the person's link, ready to link them to someone else. */
  async function unlink(roundId: string) {
    const person = (await held.pg.query("select person_id from concierge.gift_rounds where id = $1", [roundId])).rows[0].person_id;
    await held.pg.query("delete from lists.person_links where person_id = $1", [person]);
    return person as string;
  }
  /** Runs the tick's first two days with the log captured; the order.address_withdrawn events it wrote. */
  async function placeLogged(roundId: string) {
    const log = vi.spyOn(console, "log");
    try {
      await advance(roundId, 1);
      await advance(roundId, 2);
      const lines = log.mock.calls.map((c) => String(c[0]));
      return { all: lines.join("\n"), withdrawn: lines.filter((l) => l.includes("order.address_withdrawn")).map((l) => JSON.parse(l)) };
    } finally {
      log.mockRestore();
    }
  }
  /** The order ended with nothing bought, the buyer got ALL-112's email, and one ids-only event was logged. */
  async function expectWithdrawn(u: User, roundId: string, withdrawn: unknown[]) {
    expect(held.zinc.posts).toEqual([]);
    expect((await orderRows(roundId)).map((o) => [o.status, o.failure_type])).toEqual([["failed", "address_withdrawn"]]);
    expect(textFor(u)).toEqual([expect.stringContaining(WITHDRAWN)]);
    const orderId = (await held.pg.query("select id from concierge.orders where round_id = $1", [roundId])).rows[0].id;
    expect(withdrawn).toEqual([{ event: "order.address_withdrawn", at: expect.any(String), round_id: roundId, user_id: u.userId, order_id: orderId }]);
  }

  it("relinked to an owner who shares an address: the gift isn't sent there, and the buyer is told (AC-3)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const first = await shareWith(r, u);
    await approvedToShared(u, r, first);
    await unlink(r.roundId);
    const second = await shareWith(r, u);
    await held.pg.query("update public.account_addresses set address_line1 = '9 Other Rd', city = 'Toledo' where user_id = $1", [second.userId]);

    const { all, withdrawn } = await placeLogged(r.roundId);

    await expectWithdrawn(u, r.roundId, withdrawn);
    expect(textFor(first)).toEqual([]);
    expect(textFor(second)).toEqual([]);
    for (const secret of [first.userId, second.userId, "9 Other Rd", "Toledo"]) expect(all).not.toContain(secret);
  });

  it("relinked to an owner who shares nothing: it ends the same way, not at the buyer's own entry (AC-3)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const first = await shareWith(r, u);
    await approvedToShared(u, r, first);
    const person = await unlink(r.roundId);
    const second = await newUser();
    const list = await held.pg.query("insert into lists.lists (owner_id, title) values ($1, 'Wishes') returning id, share_token", [second.userId]);
    await held.pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      person,
      u.userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);

    await expectWithdrawn(u, r.roundId, (await placeLogged(r.roundId)).withdrawn);
  });

  it("a shared order with no recorded owner ends, and isn't refused tick after tick (AC-6)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    await approvedToShared(u, r, owner);
    await held.pg.query("update concierge.orders set address_owner_id = null where round_id = $1", [r.roundId]);

    await expectWithdrawn(u, r.roundId, (await placeLogged(r.roundId)).withdrawn);
  });

  it("the owner deleted their account: the order ends the same way (AC-7)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    await approvedToShared(u, r, owner);
    await held.pg.query("delete from auth.users where id = $1", [owner.userId]);
    expect((await held.pg.query("select address_owner_id from concierge.orders where round_id = $1", [r.roundId])).rows).toEqual([
      { address_owner_id: null },
    ]);

    await expectWithdrawn(u, r.roundId, (await placeLogged(r.roundId)).withdrawn);
  });

  it("the owner moved the person's link to another of their lists: it still places to them (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    await approvedToShared(u, r, owner);
    const person = await unlink(r.roundId);
    const list = await held.pg.query("insert into lists.lists (owner_id, title) values ($1, 'Holidays') returning id, share_token", [owner.userId]);
    await held.pg.query("insert into lists.person_links (person_id, buyer_id, list_id, share_token) values ($1, $2, $3, $4)", [
      person,
      u.userId,
      list.rows[0].id,
      list.rows[0].share_token,
    ]);

    await advance(r.roundId, 1);

    expect(held.zinc.posts).toEqual([expect.objectContaining({ city: "Akron" })]);
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing"]);
    const stored = await held.pg.query("select address_owner_id from concierge.orders where round_id = $1", [r.roundId]);
    expect(stored.rows).toEqual([{ address_owner_id: owner.userId }]);
  });

  it("still linked to the same owner, who moved: it places to their new address (AC-5)", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const owner = await shareWith(r, u);
    await approvedToShared(u, r, owner);
    await held.pg.query("update public.account_addresses set city = 'Toledo' where user_id = $1", [owner.userId]);

    await advance(r.roundId, 1);

    expect(held.zinc.posts).toEqual([expect.objectContaining({ city: "Toledo" })]);
    expect((await orderRows(r.roundId)).map((o) => o.status)).toEqual(["placing"]);
    const stored = await held.pg.query("select address_owner_id from concierge.orders where round_id = $1", [r.roundId]);
    expect(stored.rows).toEqual([{ address_owner_id: owner.userId }]);
  });
});
