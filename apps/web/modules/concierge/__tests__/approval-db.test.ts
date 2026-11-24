// Rejecting a round's ideas, the open round's budget, and the round screen's reads (ALL-29
// Task 9: AC-3, AC-9, AC-12, AC-13a, AC-18, AC-25, AC-29, AC-30, AC-30a) on the real local
// database (E5): the service-role client for the writes and roundAccess, and a signed-in
// user's client for roundView, so RLS is the real thing. Skipped when the stack isn't running.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "../../../test/local-db";
import type { ZincDeps } from "../zinc/types";

vi.mock("server-only", () => ({}));
const { rejectionOutlook, rejectRoundIdeas, roundAccess, roundView, setRoundBudget } = await import("../rounds/approval");
const { activeFacts } = await import("../profile/profile");

const stack = await localStack({ api: true });
const dbUp = stack !== null;

describe.skipIf(!dbUp)("approval: rejecting, the round's budget and the page reads (real local database)", () => {
  const s = stack?.supabase;
  const admin = s ? createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const password = "local-only-password";
  let pg: Client;
  const users: string[] = [];

  const deps = (): ZincDeps => ({
    db: admin!,
    http: { base: "https://zinc.test", timeoutMs: 1000, fetch: async () => new Response("{}", { status: 500 }) },
    env: "test",
    webhookBaseUrl: "https://giftsaf.test",
    now: new Date(),
  });

  // New ideas after "None of these" need the idea and round engines on; both ship off (runs_after_rejection).
  const ENGINES = ["idea_engine_enabled", "round_engine_enabled"];
  let enginesWere: { key: string; value: string }[];
  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
    enginesWere = (await pg.query("select key, value from concierge.app_settings where key = any($1)", [ENGINES])).rows;
    await pg.query("update concierge.app_settings set value = '1' where key = any($1)", [ENGINES]);
  });
  afterAll(async () => {
    for (const { key, value } of enginesWere) await pg.query("update concierge.app_settings set value = $1 where key = $2", [value, key]);
    for (const id of users) await admin!.auth.admin.deleteUser(id);
    await pg.end();
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  type User = { id: string; email: string };
  async function newUser(): Promise<User> {
    const email = `approval-${randomUUID()}@example.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    await pg.query("insert into concierge.accounts (user_id, paid_features, over_budget_pct) values ($1, true, 20)", [data.user.id]);
    return { id: data.user.id, email };
  }

  async function signedIn(u: User) {
    const db = createClient<Database>(s!.url, s!.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await db.auth.signInWithPassword({ email: u.email, password });
    if (r.error) throw r.error;
    return db;
  }

  type IdeaSpec = { title: string; total?: number; listItem?: string };
  type Round = { roundId: string; personId: string; ideaIds: string[] };
  async function newRound(
    u: User,
    o: { budget?: number | null; ideas?: IdeaSpec[]; deadlineIn?: number; status?: string; listId?: string } = {},
  ): Promise<Round> {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'Mary', 'friend') returning id", [u.id]);
    const personId = person.rows[0].id as string;
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [
      u.id,
      personId,
    ]);
    if (o.listId)
      await pg.query(
        "insert into lists.person_links (person_id, buyer_id, list_id, share_token) select $1, $2, l.id, l.share_token from lists.lists l where l.id = $3",
        [personId, u.id, o.listId],
      );
    const deadlineIn = o.deadlineIn ?? 30;
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, heads_up_on)
       values ($1, $2, $3, 2030, current_date + $4::int + 7, current_date + $4::int, $5, $6::concierge.round_status, now() + interval '1 day', current_date) returning id`,
      [u.id, personId, occasion.rows[0].id, deadlineIn, o.budget === undefined ? 10000 : o.budget, o.status ?? "awaiting_approval"],
    );
    const roundId = round.rows[0].id as string;
    const ideaIds: string[] = [];
    const specs = o.ideas ?? [{ title: "Fly rod" }, { title: "Reel" }];
    for (const [i, spec] of specs.entries()) {
      const idea = await pg.query(
        `insert into concierge.gift_ideas (user_id, round_id, person_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, list_item_id, image_url)
         values ($1, $2, $3, $4, 'https://shop.test/p', $5, $5, 2, 3, 5, $6, $7, $8, 'https://images.test/p.jpg') returning id`,
        [u.id, roundId, personId, spec.title, spec.total ?? 4000, i + 1, spec.listItem ? "list" : "generated", spec.listItem ?? null],
      );
      ideaIds.push(idea.rows[0].id as string);
    }
    return { roundId, personId, ideaIds };
  }

  async function newList(owner: User, items: { name: string; url?: string }[]) {
    const list = await pg.query("insert into lists.lists (owner_id, title) values ($1, 'Mary''s list') returning id", [owner.id]);
    const listId = list.rows[0].id as string;
    const itemIds: string[] = [];
    for (const [i, it] of items.entries()) {
      const item = await pg.query(
        "insert into lists.list_items (list_id, position, name, price_cents, product_url) values ($1, $2, $3, 3000, $4) returning id",
        [listId, i, it.name, it.url ?? null],
      );
      itemIds.push(item.rows[0].id as string);
    }
    return { listId, itemIds };
  }

  const roundRow = async (roundId: string) =>
    (
      await pg.query(
        "select status::text as status, budget_cents, locked_until, next_action_at <= now() as due from concierge.gift_rounds where id = $1",
        [roundId],
      )
    ).rows[0];
  const ideaStatuses = async (roundId: string) =>
    (await pg.query("select status from concierge.gift_ideas where round_id = $1 order by rank", [roundId])).rows.map((r) => r.status);
  const rejections = async (roundId: string) =>
    (await pg.query("select idea_id, reason_code, reason_text from concierge.rejections where round_id = $1", [roundId])).rows;
  const facts = async (personId: string) =>
    (await pg.query("select category, value, source from concierge.profile_facts where person_id = $1 order by created_at, value", [personId])).rows;

  const reject = (u: User, r: Round, o: Partial<Parameters<typeof rejectRoundIdeas>[0]> = {}) =>
    rejectRoundIdeas({ userId: u.id, roundId: r.roundId, code: "not_style", text: null, ownedIdeaId: null, expectMore: true, ...o }, deps());

  // ─── rejecting (AC-12, AC-13a, AC-25) ─────────────────────────────────────

  it("None of these with a search left saves the reason and the facts and sends the round back to generating", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const input = { roundId: r.roundId, code: "not_style" as const, text: "Nothing plastic", ownedIdeaId: null };
    expect(await rejectionOutlook(input, deps())).toBe(true);

    expect(await reject(u, r, { text: "Nothing plastic" })).toEqual({ ok: true, more: true });
    expect(await ideaStatuses(r.roundId)).toEqual(["rejected", "rejected"]);
    const rows = await rejections(r.roundId);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.reason_code === "not_style" && x.reason_text === "Nothing plastic")).toBe(true);
    expect(await facts(r.personId)).toEqual(
      expect.arrayContaining([
        { category: "avoid", value: "Not their style: Fly rod, Reel", source: "rejection" },
        { category: "avoid", value: "Nothing plastic", source: "rejection" },
      ]),
    );
    // Back to generating, due now, and the lease given back so the tick picks it up.
    expect(await roundRow(r.roundId)).toMatchObject({ status: "generating", due: true, locked_until: null });
  });

  it("the outlook for an owned idea that isn't one of the round's is null", async () => {
    const u = await newUser();
    const r = await newRound(u);
    expect(await rejectionOutlook({ roundId: r.roundId, code: "has_it", text: null, ownedIdeaId: randomUUID() }, deps())).toBeNull();
  });

  it("None of these with no search left keeps the ideas buyable", async () => {
    const u = await newUser();
    // The next tick isn't before the ship-by day: new ideas couldn't be bought in time.
    const r = await newRound(u, { deadlineIn: 1 });
    expect(await rejectionOutlook({ roundId: r.roundId, code: "has_it", text: null, ownedIdeaId: r.ideaIds[1] }, deps())).toBe(false);

    expect(await reject(u, r, { code: "has_it", ownedIdeaId: r.ideaIds[1], expectMore: false })).toEqual({ ok: true, more: false });
    expect(await ideaStatuses(r.roundId)).toEqual(["proposed", "proposed"]);
    expect(await rejections(r.roundId)).toEqual([{ idea_id: null, reason_code: "has_it", reason_text: null }]);
    expect(await facts(r.personId)).toEqual([{ category: "owns", value: "Reel", source: "rejection" }]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "awaiting_approval", locked_until: null });
  });

  it("None of these can strand a list-only person: Too pricey brings new ideas only while another list gift is left", async () => {
    const u = await newUser();
    const owner = await newUser();
    const { listId, itemIds } = await newList(owner, [
      { name: "Vase", url: "https://shop.example/vase" },
      { name: "Lamp", url: "https://shop.example/lamp" },
    ]);
    // No facts: only the list can bring ideas, and the round already offers the vase.
    const r = await newRound(u, { listId, ideas: [{ title: "Vase", listItem: itemIds[0] }] });
    const input = { roundId: r.roundId, code: "too_pricey" as const, text: null, ownedIdeaId: null };
    expect(await rejectionOutlook(input, deps())).toBe(true);

    // Someone claims the lamp: nothing is left to find.
    await pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name) values ($1, $2, 'Bea')", [itemIds[1], owner.id]);
    expect(await rejectionOutlook(input, deps())).toBe(false);
    expect(await reject(u, r, { code: "too_pricey", expectMore: true })).toEqual({ ok: false, error: "changed" });
    expect(await reject(u, r, { code: "too_pricey", expectMore: false })).toEqual({ ok: true, more: false });
    expect(await ideaStatuses(r.roundId)).toEqual(["proposed"]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "awaiting_approval", locked_until: null });
  });

  it("with the idea engine off, None of these brings no new ideas", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await pg.query("update concierge.app_settings set value = '0' where key = 'idea_engine_enabled'");
    try {
      expect(await rejectionOutlook({ roundId: r.roundId, code: "not_style", text: "No plastic", ownedIdeaId: null }, deps())).toBe(false);
    } finally {
      await pg.query("update concierge.app_settings set value = '1' where key = 'idea_engine_enabled'");
    }
  });

  it("a stale outlook returns changed and saves nothing", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: 1 });
    expect(await reject(u, r, { text: "No more mugs", expectMore: true })).toEqual({ ok: false, error: "changed" });
    expect(await ideaStatuses(r.roundId)).toEqual(["proposed", "proposed"]);
    expect(await rejections(r.roundId)).toEqual([]);
    expect(await facts(r.personId)).toEqual([]);
    expect(await roundRow(r.roundId)).toMatchObject({ status: "awaiting_approval", locked_until: null });
  });

  it("a busy round returns busy and changes nothing", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await pg.query("update concierge.gift_rounds set locked_until = now() + interval '5 minutes' where id = $1", [r.roundId]);
    expect(await reject(u, r)).toEqual({ ok: false, error: "busy" });
    expect(await ideaStatuses(r.roundId)).toEqual(["proposed", "proposed"]);
    expect(await rejections(r.roundId)).toEqual([]);
    expect(await facts(r.personId)).toEqual([]);
  });

  it("after an order was placed it returns not_open", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    expect(await reject(u, r)).toEqual({ ok: false, error: "not_open" });
    expect(await rejections(r.roundId)).toEqual([]);
  });

  it("someone else's round is not_found, and an over-long reason is too_long", async () => {
    const u = await newUser();
    const other = await newUser();
    const r = await newRound(u);
    expect(await rejectRoundIdeas({ userId: other.id, roundId: r.roundId, code: "too_pricey", text: null, ownedIdeaId: null, expectMore: true }, deps())).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await reject(u, r, { text: "x".repeat(501) })).toEqual({ ok: false, error: "too_long" });
    expect(await ideaStatuses(r.roundId)).toEqual(["proposed", "proposed"]);
  });

  it("the saved reason shows in activeFacts for the person", async () => {
    const u = await newUser();
    const r = await newRound(u);
    expect(await reject(u, r, { code: "too_generic", text: "Something handmade" })).toEqual({ ok: true, more: true });
    const shown = (await activeFacts(await signedIn(u), r.personId)).map((f) => f.value);
    expect(shown).toEqual(expect.arrayContaining(["Too generic: Fly rod, Reel", "Something handmade"]));
  });

  // ─── the round's budget (AC-9) ────────────────────────────────────────────

  it("a budget typed on the round is saved for the person and the occasion, and sets the round's budget", async () => {
    const u = await newUser();
    const r = await newRound(u, { budget: null, ideas: [{ title: "Fly rod", total: 4000 }, { title: "Waders", total: 9000 }] });
    expect(await setRoundBudget({ userId: u.id, roundId: r.roundId, budgetCents: 5000 }, await signedIn(u), deps())).toBe("saved");
    expect((await roundRow(r.roundId)).budget_cents).toBe(5000);
    expect(await roundRow(r.roundId)).toMatchObject({ locked_until: null });
    const budget = await pg.query("select occasion_kind, amount_cents from concierge.budgets where person_id = $1", [r.personId]);
    expect(budget.rows).toEqual([{ occasion_kind: "christmas", amount_cents: 5000 }]);
    const over = await pg.query("select over_budget from concierge.gift_ideas where round_id = $1 order by rank", [r.roundId]);
    expect(over.rows.map((x) => x.over_budget)).toEqual([false, true]);

    // Once set, it isn't set again.
    expect(await setRoundBudget({ userId: u.id, roundId: r.roundId, budgetCents: 7000 }, await signedIn(u), deps())).toBe("already_set");
    expect((await roundRow(r.roundId)).budget_cents).toBe(5000);
  });

  it("a budget on a busy round is busy, and on a closed round not_open", async () => {
    const u = await newUser();
    const busy = await newRound(u, { budget: null });
    await pg.query("update concierge.gift_rounds set locked_until = now() + interval '5 minutes' where id = $1", [busy.roundId]);
    expect(await setRoundBudget({ userId: u.id, roundId: busy.roundId, budgetCents: 5000 }, await signedIn(u), deps())).toBe("busy");
    const closed = await newRound(u, { budget: null, status: "skipped" });
    expect(await setRoundBudget({ userId: u.id, roundId: closed.roundId, budgetCents: 5000 }, await signedIn(u), deps())).toBe("not_open");
  });

  // ─── page reads (AC-3, AC-18, AC-29, AC-30, AC-30a) ────────────────────────

  it('roundAccess tells another account only "other"', async () => {
    const u = await newUser();
    const other = await newUser();
    const r = await newRound(u);
    expect(await roundAccess(r.roundId, u.id, deps())).toBe("mine");
    expect(await roundAccess(r.roundId, other.id, deps())).toBe("other");
    expect(await roundAccess(randomUUID(), u.id, deps())).toBe("missing");
    expect(await roundAccess("not-a-uuid", u.id, deps())).toBe("missing");
  });

  it("roundView as another user returns nothing", async () => {
    const u = await newUser();
    const other = await newUser();
    const r = await newRound(u);
    expect(await roundView(r.roundId, await signedIn(other), new Date())).toBeNull();
    const mine = await roundView(r.roundId, await signedIn(u), new Date());
    expect(mine?.ideas.map((i) => i.title)).toEqual(["Fly rod", "Reel"]);
    expect(mine?.ideas[0]).toMatchObject({ imageUrl: "https://images.test/p.jpg", source: "generated", listItemId: null });
    expect(mine?.closedText).toBeNull();
    expect(mine?.nextBestIdeaId).toBe(r.ideaIds[0]);
  });

  it("roundView greys a claimed list gift and lists an unbuyable one for Buy it yourself", async () => {
    const u = await newUser();
    const owner = await newUser();
    const { listId, itemIds } = await newList(owner, [
      { name: "Vase", url: "https://www.amazon.com/dp/B0VASE" },
      { name: "Lamp", url: "https://www.amazon.com/dp/B0LAMP" },
      { name: "Hand-thrown mug", url: "https://www.etsy.com/listing/1" },
    ]);
    await pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name) values ($1, $2, 'Bea')", [itemIds[1], owner.id]);
    const r = await newRound(u, {
      listId,
      ideas: [
        { title: "Vase", listItem: itemIds[0] },
        { title: "Lamp", listItem: itemIds[1] },
        { title: "Fly rod" },
      ],
    });
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.ideas.map((i) => [i.title, i.claimed, i.claimedByMe, i.noLongerShared])).toEqual([
      ["Vase", false, false, false],
      ["Lamp", true, false, false],
      ["Fly rod", false, false, false],
    ]);
    // The buyer's own claim (a live order in another round) shows as claimedByMe, not claimed.
    await pg.query("insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values ($1, $2, 'Me', true)", [itemIds[0], u.id]);
    const again = await roundView(r.roundId, await signedIn(u), new Date());
    expect(again?.ideas.map((i) => [i.title, i.claimed, i.claimedByMe])[0]).toEqual(["Vase", false, true]);
    await pg.query("delete from lists.gift_claims where item_id = $1", [itemIds[0]]);
    expect(view?.buyYourself).toEqual([expect.objectContaining({ itemId: itemIds[2], name: "Hand-thrown mug", productUrl: "https://www.etsy.com/listing/1", storeName: "etsy.com" })]);
    // A claimed list gift is never the next best.
    await pg.query("update concierge.gift_ideas set status = 'rejected' where id = $1", [r.ideaIds[0]]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.nextBestIdeaId).toBe(r.ideaIds[2]);
  });

  it("a Buy it yourself row shows only an https photo (AC-17)", async () => {
    const u = await newUser();
    const owner = await newUser();
    const { listId, itemIds } = await newList(owner, [
      { name: "Vase", url: "https://www.etsy.com/listing/1" },
      { name: "Lamp", url: "https://www.etsy.com/listing/2" },
      { name: "Mug", url: "https://www.etsy.com/listing/3" },
    ]);
    await pg.query("update lists.list_items set image_url = $2 where id = $1", [itemIds[0], "https://images.test/vase.jpg"]);
    // The database only lets http through for local storage (ALL-142); the page still shows https only.
    await pg.query("update lists.list_items set image_url = $2 where id = $1", [itemIds[1], "http://127.0.0.1:54321/storage/v1/object/public/list-photos/lamp.jpg"]);
    const r = await newRound(u, { listId, ideas: [{ title: "Fly rod" }] });
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.buyYourself.map((i) => [i.name, i.imageUrl])).toEqual([
      ["Vase", "https://images.test/vase.jpg"],
      ["Lamp", null],
      ["Mug", null],
    ]);
  });

  it("after the link is cut, roundView marks the round's list ideas no longer shared", async () => {
    const u = await newUser();
    const owner = await newUser();
    const { listId, itemIds } = await newList(owner, [{ name: "Vase" }, { name: "Mug" }]);
    const r = await newRound(u, { listId, ideas: [{ title: "Vase", listItem: itemIds[0] }, { title: "Fly rod" }] });
    // A new share token revokes the old link (lists.handle_share_token_changed).
    await pg.query("update lists.lists set share_token = gen_random_uuid() where id = $1", [listId]);
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.ideas.map((i) => [i.title, i.noLongerShared])).toEqual([
      ["Vase", true],
      ["Fly rod", false],
    ]);
    expect(view?.buyYourself).toEqual([]);
    expect(view?.nextBestIdeaId).toBe(r.ideaIds[1]);
  });

  it("an ordered round's view says what was ordered", async () => {
    const u = await newUser();
    const r = await newRound(u, { ideas: [{ title: "LEGO Botanical Orchid" }, { title: "Reel" }] });
    await placedOrder(u, r, 0);
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.closedText).toBe("Already ordered: LEGO Botanical Orchid");
    expect(view?.liveOrders).toEqual([expect.objectContaining({ ideaId: r.ideaIds[0], status: "placed", title: "LEGO Botanical Orchid" })]);
    expect(view?.failedOrders).toEqual([]);
  });

  it("on the ship-by day the round is closed: it's too late, and nothing is buyable", async () => {
    const u = await newUser();
    // approve_round refuses from the ship-by day on (today >= ship_by_deadline).
    const r = await newRound(u, { deadlineIn: 0 });
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.closedText).toBe("It's too late to send a gift in time");
    expect(view?.nextBestIdeaId).toBeNull();
  });

  it("a past round says the occasion has passed", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: -8, status: "skipped" });
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.closedText).toBe("This occasion has passed");
    expect(view?.nextBestIdeaId).toBeNull();
  });

  it("a skipped round whose occasion is still ahead says it's too late to send a gift", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: -3, status: "skipped" });
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("It's too late to send a gift in time");
  });

  it("on the occasion day itself the occasion hasn't passed", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: -7, status: "skipped" });
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("It's too late to send a gift in time");
  });

  it("a round skipped or closed before its ship-by day says it was stopped", async () => {
    const u = await newUser();
    const skipped = await newRound(u, { status: "skipped" });
    expect((await roundView(skipped.roundId, await signedIn(u), new Date()))?.closedText).toBe("This gift round was stopped");
    const closed = await newRound(u);
    await pg.query("update concierge.gift_rounds set closed_at = now() where id = $1", [closed.roundId]);
    expect((await roundView(closed.roundId, await signedIn(u), new Date()))?.closedText).toBe("This gift round was stopped");
  });

  it("a closed round with a gift on its way says so, never that it's too late", async () => {
    const u = await newUser();
    const r = await newRound(u, { ideas: [{ title: "Fly rod" }, { title: "Reel" }] });
    await placedOrder(u, r, 0);
    await pg.query("update concierge.gift_rounds set status = 'skipped', ship_by_deadline = current_date where id = $1", [r.roundId]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("Already ordered: Fly rod");
  });

  // ─── what a waiting round is doing ──

  const waiting = async (u: User, roundId: string) => (await roundView(roundId, await signedIn(u), new Date()))?.waiting;
  const tellNoIdeas = (u: User, r: Round, sentAt: string | null, error: string | null) =>
    pg.query("insert into concierge.notifications (user_id, round_id, person_id, kind, channel, sent_at, error) values ($1, $2, $3, 'no_ideas', 'email', $4, $5)", [
      u.id,
      r.roundId,
      r.personId,
      sentAt,
      error,
    ]);
  const giveAddress = (r: Round) =>
    pg.query(
      `update public.people set recipient_first_name = 'Mary', recipient_last_name = 'Allen', address_line1 = '12 Oak St', city = 'Dayton', state = 'OH', zip = '45402' where id = $1`,
      [r.personId],
    );

  it.each(["scheduled", "generating", "needs_address"])("a %s round with an address is looking, until the no-ideas email went", async (status) => {
    const u = await newUser();
    const r = await newRound(u, { status, ideas: [] });
    await giveAddress(r);
    expect(await waiting(u, r.roundId)).toBe("looking");
    await tellNoIdeas(u, r, null, "refused");
    expect(await waiting(u, r.roundId)).toBe("looking");
    await tellNoIdeas(u, r, new Date(Date.now() - 60_000).toISOString(), null);
    expect(await waiting(u, r.roundId)).toBe("told");
    // Found, then "None of these": the round is looking again.
    await pg.query(
      `insert into concierge.gift_ideas (user_id, round_id, person_id, title, product_url, price_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, rank, source, status)
       values ($1, $2, $3, 'Net', 'https://shop.test/p', 4000, 4000, 2, 3, 5, 1, 'generated', 'rejected')`,
      [u.id, r.roundId, r.personId],
    );
    expect(await waiting(u, r.roundId)).toBe("looking");
  });

  it.each(["scheduled", "needs_address"])("a %s round with no address asks for it, until one is saved", async (status) => {
    const u = await newUser();
    const r = await newRound(u, { status, ideas: [] });
    expect(await waiting(u, r.roundId)).toBe("address");
    await giveAddress(r);
    expect(await waiting(u, r.roundId)).toBe("looking");
  });

  it("after the no-ideas email, a missing address is still what it waits on", async () => {
    const u = await newUser();
    const r = await newRound(u, { status: "needs_address", ideas: [] });
    await tellNoIdeas(u, r, new Date(Date.now() - 60_000).toISOString(), null);
    expect(await waiting(u, r.roundId)).toBe("address");
  });

  it("an incomplete address still asks", async () => {
    const u = await newUser();
    const r = await newRound(u, { status: "needs_address", ideas: [] });
    await pg.query("update public.people set city = 'Dayton' where id = $1", [r.personId]);
    expect(await waiting(u, r.roundId)).toBe("address");
  });

  it("only an emailed no-ideas counts", async () => {
    const u = await newUser();
    const r = await newRound(u, { status: "generating", ideas: [] });
    await pg.query("insert into concierge.notifications (user_id, round_id, person_id, kind, channel, sent_at) values ($1, $2, $3, 'no_ideas', 'push', now())", [
      u.id,
      r.roundId,
      r.personId,
    ]);
    expect(await waiting(u, r.roundId)).toBe("looking");
  });

  it("a failed read of what it's waiting on is logged and never breaks the page", async () => {
    const u = await newUser();
    const r = await newRound(u, { status: "generating", ideas: [] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const db = await signedIn(u);
      const schema = db.schema.bind(db);
      vi.spyOn(db, "schema").mockImplementation(((name: "concierge") => {
        const s = schema(name);
        const from = s.from.bind(s);
        s.from = ((table: string) => {
          if (table === "notifications") throw new Error("read failed for jordan@example.com");
          return from(table as "gift_rounds");
        }) as typeof s.from;
        return s;
      }) as unknown as typeof db.schema);
      const view = await roundView(r.roundId, db, new Date());
      expect(view?.round.id).toBe(r.roundId);
      expect(view?.waiting).toBeNull();
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("round_waiting_failed"))).toBe(true);
      expect(lines.join()).not.toContain("jordan@example.com");
    } finally {
      log.mockRestore();
    }
  });

  it("a list owner's shared address counts", async () => {
    const u = await newUser();
    const owner = await newUser();
    const { listId } = await newList(owner, [{ name: "Vase" }]);
    const r = await newRound(u, { status: "needs_address", ideas: [], listId });
    expect(await waiting(u, r.roundId)).toBe("address");
    await pg.query(
      `insert into public.account_addresses (user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
       values ($1, 'Mary', 'Allen', '9 Elm St', 'Dayton', 'OH', '45402', true)`,
      [owner.id],
    );
    expect(await waiting(u, r.roundId)).toBe("looking");
  });

  it("without paid features nothing is looked for, and nothing is said", async () => {
    const u = await newUser();
    await pg.query("update concierge.accounts set paid_features = false where user_id = $1", [u.id]);
    const r = await newRound(u, { status: "generating", ideas: [] });
    await giveAddress(r);
    expect(await waiting(u, r.roundId)).toBeNull();
  });

  it("a round that isn't waiting on ideas, or is closed, has nothing to say", async () => {
    const u = await newUser();
    expect(await waiting(u, (await newRound(u)).roundId)).toBeNull();
    expect(await waiting(u, (await newRound(u, { status: "generating", deadlineIn: 0, ideas: [] })).roundId)).toBeNull();
  });

  // ─── closed, with money still in question ──

  it.each(["unconfirmed", "placing"])("a closed round with an %s order says it's still confirming, never that nothing is coming", async (status) => {
    const u = await newUser();
    const r = await newRound(u, { ideas: [{ title: "Fly rod" }, { title: "Reel" }] });
    await placedOrder(u, r, 0);
    await placedOrder(u, r, 1);
    await pg.query("update concierge.orders set status = $2 where round_id = $1 and idea_id = $3", [r.roundId, status, r.ideaIds[0]]);
    await pg.query("update concierge.orders set status = 'cancelled' where round_id = $1 and idea_id = $2", [r.roundId, r.ideaIds[1]]);
    await pg.query("update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'unconfirmed', closed_at = now() where id = $1", [r.roundId]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("We're still confirming your order.");
  });

  it.each([
    ["past ship-by, still open", "ship_by_deadline = current_date"],
    ["after the occasion", "ship_by_deadline = current_date - 9, occasion_date = current_date - 2"],
  ])("an unconfirmed order %s says it's still confirming", async (_what, set) => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    await pg.query("update concierge.orders set status = 'unconfirmed' where round_id = $1", [r.roundId]);
    await pg.query(`update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'unconfirmed', ${set} where id = $1`, [r.roundId]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("We're still confirming your order.");
  });

  it("an ordered round whose only order is still placing says it's confirming, not ordered", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    await pg.query("update concierge.orders set status = 'placing' where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'ordered' where id = $1", [r.roundId]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("We're still confirming your order.");
  });

  it("a gift the store cancelled in a round the tick hasn't closed yet leaves no gift on its way", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    await pg.query("update concierge.orders set status = 'failed', failure_type = 'store_cancelled' where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'failed', ship_by_deadline = current_date where id = $1", [r.roundId]);
    expect((await roundView(r.roundId, await signedIn(u), new Date()))?.closedText).toBe("No gift is on its way");
  });

  it("a gift the store cancelled leaves no gift on its way, before or after ship-by", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    await pg.query("update concierge.orders set status = 'failed', failure_type = 'store_cancelled', resolved = true where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'skipped', closed_at = now() where id = $1", [r.roundId]);
    const text = async () => (await roundView(r.roundId, await signedIn(u), new Date()))?.closedText;
    expect(await text()).toBe("No gift is on its way");
    await pg.query("update concierge.gift_rounds set ship_by_deadline = current_date where id = $1", [r.roundId]);
    expect(await text()).toBe("No gift is on its way");
  });

  it("a failure resolved by replace_failed_order is no longer in failedOrders", async () => {
    const u = await newUser();
    const r = await newRound(u, { ideas: [{ title: "Fly rod" }, { title: "Reel" }] });
    await pg.query("update concierge.gift_ideas set status = 'selected' where id = $1", [r.ideaIds[0]]);
    const failed = await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, ship_to, ship_city, ship_state, status, failure_type)
       values ($1, $2, $3, 'zinc_wallet', 4520, 100, 'recipient', 'Dayton', 'OH', 'failed', 'out_of_stock') returning id`,
      [u.id, r.roundId, r.ideaIds[0]],
    );
    await pg.query("update concierge.gift_rounds set status = 'needs_attention', attention_reason = 'out_of_stock' where id = $1", [r.roundId]);
    const before = await roundView(r.roundId, await signedIn(u), new Date());
    expect(before?.failedOrders.map((o) => o.id)).toEqual([failed.rows[0].id]);

    const lock = (await pg.query("select locked_until::text from concierge.claim_round_now($1, now())", [r.roundId])).rows[0].locked_until;
    const order = {
      idea_id: r.ideaIds[1],
      max_price_cents: 4520,
      fee_cents: 100,
      ship_to: "recipient",
      address_source: "own",
      address: { recipient_first_name: "Mary", recipient_last_name: "Allen", address_line1: "12 Oak St", city: "Dayton", state: "OH", zip: "45402", country: "US" },
    };
    await pg.query("select concierge.replace_failed_order($1, $2, $3, $4, $5)", [r.roundId, u.id, lock, failed.rows[0].id, JSON.stringify(order)]);
    await pg.query("select concierge.release_round($1, $2)", [r.roundId, lock]);

    const after = await roundView(r.roundId, await signedIn(u), new Date());
    expect(after?.failedOrders).toEqual([]);
    expect(after?.liveOrders.map((o) => o.ideaId)).toEqual([r.ideaIds[1]]);
  });

  it("a refunded order isn't live, and a closed round says no gift is on its way", async () => {
    const u = await newUser();
    const r = await newRound(u);
    await placedOrder(u, r, 0);
    await pg.query("update concierge.orders set status = 'refunded' where round_id = $1", [r.roundId]);
    await pg.query("update concierge.gift_rounds set status = 'needs_attention', closed_at = now() where id = $1", [r.roundId]);
    const view = await roundView(r.roundId, await signedIn(u), new Date());
    expect(view?.liveOrders).toEqual([]);
    expect(view?.closedText).toBe("No gift is on its way");
    expect(view?.nextBestIdeaId).toBeNull();
  });

  it("the lease is given back when reject_round_ideas throws", async () => {
    const u = await newUser();
    const r = await newRound(u);
    const d = { ...deps(), db: failingRpc("reject_round_ideas") };
    await expect(rejectRoundIdeas({ userId: u.id, roundId: r.roundId, code: "not_style", text: null, ownedIdeaId: null, expectMore: true }, d)).rejects.toThrow();
    expect(await roundRow(r.roundId)).toMatchObject({ status: "awaiting_approval", locked_until: null });
  });

  it("a refused round budget leaves the person's budget unchanged", async () => {
    const u = await newUser();
    const r = await newRound(u, { budget: null });
    const d = { ...deps(), db: failingRpc("set_round_budget", { code: "P0001", message: "set_round_budget: already set" }) };
    expect(await setRoundBudget({ userId: u.id, roundId: r.roundId, budgetCents: 5000 }, await signedIn(u), d)).toBe("already_set");
    expect((await pg.query("select 1 from concierge.budgets where person_id = $1", [r.personId])).rows).toEqual([]);
    expect(await roundRow(r.roundId)).toMatchObject({ budget_cents: null, locked_until: null });
  });

  it("a rejection with no search left logs round.rejection_noted with count 0", async () => {
    const u = await newUser();
    const r = await newRound(u, { deadlineIn: 1 });
    // logEvent writes one JSON event per line.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await reject(u, r, { expectMore: false })).toEqual({ ok: true, more: false });
      const events = spy.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(events).toContainEqual(
        expect.objectContaining({ event: "round.rejection_noted", round_id: r.roundId, user_id: u.id, reason_code: "not_style", count: 0 }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  /** Our real database, with one concierge function failing, like a dropped connection would. */
  function failingRpc(name: string, err: { code: string; message: string } = { code: "XX000", message: "down" }) {
    const real = admin!;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "schema") return Reflect.get(target, prop, receiver);
        return (schema: "concierge") => {
          const sc = target.schema(schema);
          return new Proxy(sc, {
            get(t, p, rr) {
              if (p !== "rpc") return Reflect.get(t, p, rr);
              return (fn: string, args: Record<string, unknown>) =>
                fn === name ? Promise.resolve({ data: null, error: err }) : (t.rpc as (f: string, a: unknown) => unknown).call(t, fn, args);
            },
          });
        };
      },
    });
  }

  async function placedOrder(u: User, r: Round, index: number) {
    await pg.query("update concierge.gift_ideas set status = 'selected' where id = $1", [r.ideaIds[index]]);
    await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, ship_to, ship_city, ship_state, status, total_cents)
       values ($1, $2, $3, 'zinc_wallet', 4520, 100, 'recipient', 'Dayton', 'OH', 'placed', 4000)`,
      [u.id, r.roundId, r.ideaIds[index]],
    );
    await pg.query("update concierge.gift_rounds set status = 'ordered' where id = $1", [r.roundId]);
  }
});
