// @vitest-environment node
// Connect, phone, disconnect (ALL-32 Task 4, AC-1 to AC-9, AC-12). Our own
// database is real (local Supabase, E5); only Zinc is faked. Skipped when the
// local database isn't running (the unit-test CI job has none).
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@gifts-af/core";
import { localSupabase } from "../../../e2e/local-supabase";
import {
  cancelConnect,
  disconnect,
  getPaymentStatus,
  pollConnect,
  savePhone,
  startConnect,
  type PaymentStatus,
} from "../zinc/connect";
import type { ZincDeps } from "../zinc/types";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const KEY = "zn_live_SECRETKEY123";
const WEBHOOK_SECRET = "zn_whsec_SECRET456";
const DEVICE_CODE = "DEVICE-CODE-SECRET-789";

async function localDbUp(): Promise<boolean> {
  const c = new Client({ connectionString: LOCAL_DB, connectionTimeoutMillis: 1000 });
  try {
    await c.connect();
    await c.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const dbUp = await localDbUp();
const supabase = dbUp ? localSupabase() : null;

type Call = { method: string; path: string; auth: string | null; body: unknown };
type Handler = (call: Call) => Response | Promise<Response>;
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
type Connected = Extract<PaymentStatus, { kind: "connected" }>;

describe.skipIf(!dbUp)("Zinc connect (real local database, fake Zinc)", () => {
  let pg: Client;
  const users: string[] = [];
  const placeHeld = vi.fn(async () => {});

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    if (users.length) await pg.query("delete from auth.users where id = any($1::uuid[])", [users]);
    await pg.end();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    placeHeld.mockClear();
  });

  async function newUser(paid: boolean): Promise<string> {
    const id = randomUUID();
    users.push(id);
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
      [id, `connect-${id}@example.com`],
    );
    await pg.query("insert into concierge.accounts (user_id, paid_features) values ($1, $2)", [id, paid]);
    return id;
  }

  const happy: Handler = ({ method, path }) => {
    if (path === "/device/code")
      return json(200, {
        device_code: DEVICE_CODE,
        user_code: "K7QX-4M2P",
        verification_uri: "https://zinc.test/activate",
        verification_uri_complete: "https://zinc.test/activate?c=K7QX-4M2P",
        expires_in: 900,
        interval: 5,
      });
    if (path === "/device/token") return json(200, { key: KEY });
    if (path === "/webhooks/endpoint") return method === "PUT" ? json(200, { webhook_secret: WEBHOOK_SECRET }) : json(204);
    if (path === "/wallet/me") return json(200, { spendable_balance: 4000 });
    if (path === "/sandbox/keys") return json(201, { api_key: "zn_test_SANDBOX" });
    return json(404, { error: { code: "not_found" } });
  };

  function zinc(handler: Handler = happy, env: "test" | "live" = "live") {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const call: Call = {
        method: init.method ?? "GET",
        path: u.pathname,
        auth: new Headers(init.headers).get("authorization"),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch;
    const db = createClient<Database>(supabase!.url, supabase!.serviceRoleKey, { auth: { persistSession: false } });
    const deps: ZincDeps = {
      db,
      http: { base: "https://zinc.test", timeoutMs: 1000, fetch: f },
      env,
      webhookBaseUrl: "https://giftsaf.test",
      now: new Date(),
    };
    return { deps, calls };
  }

  /** Connect, click Allow, and poll once: a connected user. */
  async function connected(userId: string, z = zinc()) {
    await startConnect(userId, z.deps, placeHeld);
    const status = await pollConnect(userId, z.deps, placeHeld);
    expect(status).toMatchObject({ kind: "connected" });
    return z;
  }

  const secretsIn = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const secret of [KEY, WEBHOOK_SECRET, DEVICE_CODE]) expect(text).not.toContain(secret);
  };

  async function placeOrder(userId: string, status: "held" | "placing"): Promise<string> {
    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [userId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, person.rows[0].id]);
    const round = await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 37, current_date + 30, 5000, $4::concierge.round_status, now()) returning id`,
      [userId, person.rows[0].id, occasion.rows[0].id, status === "held" ? "needs_attention" : "ordered"],
    );
    const idea = await pg.query(
      "insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank) values ($1, $2, 'Mug', 4000, 4500, 1) returning id",
      [userId, round.rows[0].id],
    );
    const order = await pg.query(
      `insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
       values ($1, $2, $3, 'zinc_wallet', 4500, 100, $4, $5, 'recipient', 'Dayton', 'OH') returning id`,
      [userId, round.rows[0].id, idea.rows[0].id, status, status === "held" ? "retry" : null],
    );
    await pg.query(
      `insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
       values ($1, $2, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US')`,
      [order.rows[0].id, userId],
    );
    await pg.query("select concierge.reconcile_round($1)", [round.rows[0].id]);
    return order.rows[0].id;
  }

  it("refuses everything without paid features and never calls Zinc (AC-1)", async () => {
    const userId = await newUser(false);
    const z = zinc();
    const results = [
      await getPaymentStatus(userId, z.deps),
      await startConnect(userId, z.deps, placeHeld),
      await pollConnect(userId, z.deps, placeHeld),
      await cancelConnect(userId, z.deps),
      await disconnect(userId, z.deps),
      await savePhone(userId, "5551234567", z.deps, placeHeld),
    ];
    for (const r of results) expect(r).toEqual({ kind: "not_allowed" });
    expect(z.calls).toEqual([]);
  });

  it("starts a connection: keeps the device code server-side, shows only the user code (AC-2)", async () => {
    const userId = await newUser(true);
    const z = zinc();
    const status = await startConnect(userId, z.deps, placeHeld);
    expect(status).toMatchObject({
      kind: "waiting",
      userCode: "K7QX-4M2P",
      verificationUrl: "https://zinc.test/activate?c=K7QX-4M2P",
      intervalSec: 5,
    });
    expect(z.calls.map((c) => c.path)).toEqual(["/device/code"]);
    const { rows } = await pg.query("select device_code from concierge.zinc_connect_attempts where user_id = $1", [userId]);
    expect(rows[0].device_code).toBe(DEVICE_CODE);
    secretsIn(status);
    // Reading the page while waiting shows the same code and calls nothing.
    expect(await getPaymentStatus(userId, z.deps)).toMatchObject({ kind: "waiting", userCode: "K7QX-4M2P" });
    expect(z.calls).toHaveLength(1);
    // A second tap or tab shows the same code instead of issuing another.
    expect(await startConnect(userId, z.deps, placeHeld)).toMatchObject({ kind: "waiting", userCode: "K7QX-4M2P" });
    expect(z.calls.filter((c) => c.path === "/device/code")).toHaveLength(1);
  });

  it("on Allow, stores the secrets and registers our webhook URL (AC-3)", async () => {
    const userId = await newUser(true);
    const z = zinc();
    await startConnect(userId, z.deps, placeHeld);
    const status = await pollConnect(userId, z.deps, placeHeld);

    expect(status).toMatchObject({ kind: "connected", balanceCents: 4000, autoTopUp: null, phone: null });
    const put = z.calls.find((c) => c.method === "PUT" && c.path === "/webhooks/endpoint")!;
    expect(put.auth).toBe(`Bearer ${KEY}`);
    const { rows } = await pg.query(
      "select zinc_webhook_id, zinc_env, zinc_connected_at from concierge.accounts where user_id = $1",
      [userId],
    );
    expect((put.body as { url: string }).url).toBe(`https://giftsaf.test/api/zinc/webhook/${rows[0].zinc_webhook_id}`);
    expect(rows[0].zinc_webhook_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].zinc_env).toBe("live");
    expect(rows[0].zinc_connected_at).not.toBeNull();
    const secrets = await pg.query("select api_key, webhook_secret from concierge.zinc_secrets($1)", [userId]);
    expect(secrets.rows[0]).toEqual({ api_key: KEY, webhook_secret: WEBHOOK_SECRET });
    const attempt = await pg.query("select 1 from concierge.zinc_connect_attempts where user_id = $1", [userId]);
    expect(attempt.rowCount).toBe(0);
    secretsIn(status);
    expect(placeHeld).not.toHaveBeenCalled(); // no phone yet, so setup isn't finished
  });

  it("two tabs polling at once make one /device/token call and neither sees an error (AC-3)", async () => {
    const userId = await newUser(true);
    const z = zinc(async (c) => {
      if (c.path === "/device/token") {
        await new Promise((r) => setTimeout(r, 150));
        return json(400, { error: { code: "authorization_pending" } });
      }
      return happy(c);
    });
    await startConnect(userId, z.deps, placeHeld);
    const [a, b] = await Promise.all([pollConnect(userId, z.deps, placeHeld), pollConnect(userId, z.deps, placeHeld)]);
    expect(z.calls.filter((c) => c.path === "/device/token")).toHaveLength(1);
    expect(a).toMatchObject({ kind: "waiting" });
    expect(b).toMatchObject({ kind: "waiting" });
    // The claim lasts one Zinc interval, counted from when Zinc answered, so an early extra poll is not sent either.
    await pollConnect(userId, z.deps, placeHeld);
    expect(z.calls.filter((c) => c.path === "/device/token")).toHaveLength(1);
    const held = await pg.query("select polling_until > now() as held from concierge.zinc_connect_attempts where user_id = $1", [userId]);
    expect(held.rows[0].held).toBe(true);
  });

  it("an expired, denied or cancelled code returns to not connected and deletes the row (AC-4)", async () => {
    const expiredUser = await newUser(true);
    const e = zinc();
    await startConnect(expiredUser, e.deps, placeHeld);
    await pg.query("update concierge.zinc_connect_attempts set expires_at = now() - interval '1 minute' where user_id = $1", [expiredUser]);
    expect(await pollConnect(expiredUser, e.deps, placeHeld)).toMatchObject({ kind: "not_connected", notice: expect.stringContaining("expired") });
    expect(e.calls.filter((c) => c.path === "/device/token")).toHaveLength(0);

    for (const code of ["access_denied", "expired_token"]) {
      const userId = await newUser(true);
      const z = zinc((c) => (c.path === "/device/token" ? json(400, { error: { code } }) : happy(c)));
      await startConnect(userId, z.deps, placeHeld);
      const status = await pollConnect(userId, z.deps, placeHeld);
      expect(status).toMatchObject({ kind: "not_connected", notice: expect.any(String) });
      const gone = await pg.query("select 1 from concierge.zinc_connect_attempts where user_id = $1", [userId]);
      expect(gone.rowCount).toBe(0);
    }

    const cancelUser = await newUser(true);
    const c = zinc();
    await startConnect(cancelUser, c.deps, placeHeld);
    expect(await cancelConnect(cancelUser, c.deps)).toMatchObject({ kind: "not_connected" });
    const gone = await pg.query("select 1 from concierge.zinc_connect_attempts where user_id = $1", [cancelUser]);
    expect(gone.rowCount).toBe(0);
    const stored = await pg.query("select zinc_connected_at from concierge.accounts where user_id = $1", [cancelUser]);
    expect(stored.rows[0].zinc_connected_at).toBeNull();
  });

  it("test environment connects with a sandbox key instead of the Allow flow", async () => {
    const userId = await newUser(true);
    const z = zinc(happy, "test");
    const status = await startConnect(userId, z.deps, placeHeld);
    expect(status).toMatchObject({ kind: "connected" });
    expect(z.calls.map((c) => c.path)).not.toContain("/device/code");
    const secrets = await pg.query("select api_key, zinc_env from concierge.zinc_secrets($1)", [userId]);
    expect(secrets.rows[0]).toEqual({ api_key: "zn_test_SANDBOX", zinc_env: "test" });
  });

  it("shows the balance as unknown when Zinc is unreachable, and still renders (AC-9)", async () => {
    const userId = await newUser(true);
    await connected(userId);
    const down = zinc(() => json(503, { error: { code: "unavailable" } }));
    expect(await getPaymentStatus(userId, down.deps)).toMatchObject({ kind: "connected", balanceCents: null });
    const dead = zinc(() => {
      throw new Error("network down");
    });
    expect(await getPaymentStatus(userId, dead.deps)).toMatchObject({ kind: "connected", balanceCents: null });
  });

  it("reports auto top-up from our record, the look-ahead and the suggested minimum (AC-9, AC-10, AC-12)", async () => {
    const userId = await newUser(true);
    await connected(userId);
    let status = (await getPaymentStatus(userId, zinc().deps)) as Connected;
    expect(status.autoTopUp).toBeNull();
    expect(status.suggestedMinimumCents).toBeNull();
    expect(status.lookahead).toEqual({ cents: 0, atLeast: false });
    expect(status.topUpSuggestCents).toBe(10000);
    expect([status.topUpFeeBps, status.topUpFeeFixedCents, status.lookaheadDays, status.feeCents]).toEqual([290, 30, 21, 100]);

    const person = await pg.query("insert into public.people (user_id, name, relationship) values ($1, 'P', 'friend') returning id", [userId]);
    const personId = person.rows[0].id;
    await pg.query("insert into concierge.budget_defaults (user_id, relationship, base_amount_cents) values ($1, 'friend', 10000)", [userId]);
    await pg.query("insert into concierge.budgets (user_id, person_id, occasion_kind, amount_cents) values ($1, $2, 'christmas', 6000)", [userId, personId]);
    const occasion = await pg.query("insert into concierge.occasions (user_id, person_id, kind) values ($1, $2, 'christmas') returning id", [userId, personId]);
    await pg.query(
      `insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
       values ($1, $2, $3, 2030, current_date + 15, current_date + 10, 6000, 'awaiting_approval', now())`,
      [userId, personId, occasion.rows[0].id],
    );
    await pg.query("update concierge.accounts set auto_topup_on = true where user_id = $1", [userId]);
    status = (await getPaymentStatus(userId, zinc().deps)) as Connected;
    expect(status.autoTopUp).toBe(true);
    expect(status.suggestedMinimumCents).toBe(10100); // largest budget + the $1 fee
    expect(status.lookahead).toEqual({ cents: 6100, atLeast: false });
  });

  it("saves a phone as 10 digits and rejects short input (AC-8)", async () => {
    const userId = await newUser(true);
    const z = await connected(userId);
    expect(await savePhone(userId, "123", z.deps, placeHeld)).toEqual({ error: expect.stringContaining("10") });
    expect(placeHeld).not.toHaveBeenCalled();
    const status = await savePhone(userId, "+1 (555) 123-4567", z.deps, placeHeld);
    expect(status).toMatchObject({ kind: "connected", phone: "5551234567" });
    const { rows } = await pg.query("select buyer_phone from concierge.accounts where user_id = $1", [userId]);
    expect(rows[0].buyer_phone).toBe("5551234567");
    expect(placeHeld).toHaveBeenCalledWith(userId);
    // Not connected: nowhere to keep it.
    const other = await newUser(true);
    expect(await savePhone(other, "5551234567", z.deps, placeHeld)).toEqual({ error: expect.any(String) });
  });

  it("is refused to disconnect while an order is placing (AC-5)", async () => {
    const userId = await newUser(true);
    const z = await connected(userId);
    await placeOrder(userId, "placing");
    expect(await disconnect(userId, z.deps)).toEqual({ error: expect.any(String) });
    expect(z.calls.filter((c) => c.method === "DELETE")).toEqual([]);
    const { rows } = await pg.query("select zinc_connected_at from concierge.accounts where user_id = $1", [userId]);
    expect(rows[0].zinc_connected_at).not.toBeNull();
  });

  it("disconnects: forgets the secrets first, then clears the webhook; held orders wait for setup (AC-5)", async () => {
    const userId = await newUser(true);
    await connected(userId);
    await savePhone(userId, "5551234567", zinc().deps, placeHeld);
    const orderId = await placeOrder(userId, "held");
    let secretsLeftWhenCleared: number | null = null;
    const z = zinc(async (c) => {
      if (c.method === "DELETE") {
        const r = await pg.query("select count(*)::int as n from concierge.zinc_secrets($1)", [userId]);
        secretsLeftWhenCleared = r.rows[0].n;
      }
      return happy(c);
    });
    const status = await disconnect(userId, z.deps);
    expect(status).toMatchObject({ kind: "not_connected", notice: expect.stringContaining("revoke") });
    expect(secretsLeftWhenCleared).toBe(0);
    expect(z.calls.find((c) => c.method === "DELETE")!.auth).toBe(`Bearer ${KEY}`);
    const acct = await pg.query("select zinc_connected_at, zinc_webhook_id, buyer_phone from concierge.accounts where user_id = $1", [userId]);
    expect(acct.rows[0]).toEqual({ zinc_connected_at: null, zinc_webhook_id: null, buyer_phone: null });
    const order = await pg.query("select status, hold_reason from concierge.orders where id = $1", [orderId]);
    expect(order.rows[0]).toEqual({ status: "held", hold_reason: "setup" });
    secretsIn(status);
  });

  it("a failed webhook clear is logged, not fatal, and the page still says to revoke the key (AC-5)", async () => {
    const userId = await newUser(true);
    await connected(userId);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const z = zinc((c) => (c.method === "DELETE" ? json(503, { error: { code: "unavailable" } }) : happy(c)));
    const status = await disconnect(userId, z.deps);
    expect(status).toMatchObject({ kind: "not_connected", notice: expect.stringContaining("revoke") });
    secretsIn(log.mock.calls);
  });

  it("no log line or action result contains the key, the webhook secret or the device code (AC-6)", async () => {
    const out: unknown[] = [];
    for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a) => void out.push(a));
    const userId = await newUser(true);
    const results: unknown[] = [];
    const z = zinc();
    results.push(await startConnect(userId, z.deps, placeHeld));
    results.push(await pollConnect(userId, z.deps, placeHeld));
    results.push(await getPaymentStatus(userId, z.deps));
    results.push(await savePhone(userId, "5551234567", z.deps, placeHeld));
    results.push(await savePhone(userId, "1", z.deps, placeHeld));
    const bad = zinc(() => json(503, { error: { code: "unavailable" } }));
    results.push(await getPaymentStatus(userId, bad.deps));
    results.push(await disconnect(userId, bad.deps));
    results.push(await startConnect(userId, bad.deps, placeHeld));
    secretsIn(results);
    secretsIn(out);
  });
});
