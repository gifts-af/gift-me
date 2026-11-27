// A fake Stripe HTTP API for card tests against the real local database (E5: fake only what we
// don't own). Just the calls stripe/card.ts makes: customers, setup-mode Checkout Sessions,
// listing, reading and detaching a customer's cards.
import type { StripeHttp } from "../stripe/client";

export type StripeRequest = { method: string; path: string; body: URLSearchParams; idempotencyKey: string | null };

type Session = {
  id: string;
  status: "open" | "complete" | "expired";
  mode: string;
  livemode: boolean;
  customer: string | null;
  setup_intent: { id: string; status: string; usage: string; payment_method: string | null } | null;
};

export class FakeStripe {
  requests: StripeRequest[] = [];
  customers = new Map<string, { metadata: Record<string, string> }>();
  /** Payment methods attached to each customer. */
  cards = new Map<string, string[]>();
  brands = new Map<string, { brand: string; last4: string }>();
  sessions = new Map<string, Session>();
  /** Payment method ids whose detach fails with a 500. */
  failDetach = new Set<string>();
  /** When set, creating a Checkout Session answers with this status (a 500, say). */
  sessionStatus: number | null = null;
  /** Runs after a customer is created, before the answer goes back (to race another start). */
  afterCustomer: (() => Promise<void>) | null = null;
  private byIdem = new Map<string, string>();
  private n = 0;

  constructor(private mode: "test" | "live" = "test") {}

  http(timeoutMs = 1000): StripeHttp {
    return { key: `sk_${this.mode}_fake`, mode: this.mode, timeoutMs, fetch: this.fetch };
  }

  private id(prefix: string): string {
    this.n += 1;
    return `${prefix}_${this.mode}_${this.n}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** The buyer finishes Stripe's page: a card is attached and the session completes. */
  complete(sessionId: string, o: { brand?: string; last4?: string; usage?: string; siStatus?: string } = {}): string {
    const s = this.sessions.get(sessionId)!;
    const pm = this.id("pm");
    this.brands.set(pm, { brand: o.brand ?? "visa", last4: o.last4 ?? "4242" });
    if (s.customer) this.cards.set(s.customer, [...(this.cards.get(s.customer) ?? []), pm]);
    s.status = "complete";
    s.setup_intent = { id: this.id("seti"), status: o.siStatus ?? "succeeded", usage: o.usage ?? "off_session", payment_method: pm };
    return pm;
  }

  fetch = (async (input: string, init?: RequestInit) => {
    const u = new URL(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const idem = headers["Idempotency-Key"] ?? null;
    this.requests.push({ method, path: u.pathname, body, idempotencyKey: idem });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    const missing = () => json(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such thing" } });

    if (method === "POST" && u.pathname === "/v1/customers") {
      const known = idem ? this.byIdem.get(idem) : undefined;
      if (known) return json(200, { id: known, object: "customer" });
      const id = this.id("cus");
      const metadata: Record<string, string> = {};
      for (const [k, v] of body) {
        const m = /^metadata\[(.+)\]$/.exec(k);
        if (m) metadata[m[1]] = v;
      }
      this.customers.set(id, { metadata });
      if (idem) this.byIdem.set(idem, id);
      if (this.afterCustomer) await this.afterCustomer();
      return json(200, { id, object: "customer" });
    }
    if (method === "POST" && u.pathname === "/v1/checkout/sessions") {
      if (this.sessionStatus !== null) return json(this.sessionStatus, { error: { type: "api_error", message: "Stripe broke" } });
      const id = this.id("cs");
      this.sessions.set(id, {
        id,
        status: "open",
        mode: body.get("mode") ?? "",
        livemode: this.mode === "live",
        customer: body.get("customer"),
        setup_intent: null,
      });
      return json(200, { id, url: `https://checkout.stripe.test/c/${id}` });
    }
    const session = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(u.pathname);
    if (method === "GET" && session) {
      const s = this.sessions.get(session[1]);
      if (!s) return missing();
      const expand = u.searchParams.getAll("expand[]").includes("setup_intent");
      return json(200, { ...s, setup_intent: expand ? s.setup_intent : (s.setup_intent?.id ?? null) });
    }
    const list = /^\/v1\/customers\/([^/]+)\/payment_methods$/.exec(u.pathname);
    if (method === "GET" && list) {
      if (!this.customers.has(list[1])) return missing();
      return json(200, { object: "list", has_more: false, data: (this.cards.get(list[1]) ?? []).map((id) => ({ id })) });
    }
    const detach = /^\/v1\/payment_methods\/([^/]+)\/detach$/.exec(u.pathname);
    if (method === "POST" && detach) {
      if (this.failDetach.has(detach[1])) return json(500, { error: { type: "api_error", message: "pm_x broke" } });
      for (const [c, ids] of this.cards) this.cards.set(c, ids.filter((x) => x !== detach[1]));
      return json(200, { id: detach[1] });
    }
    const pm = /^\/v1\/payment_methods\/([^/]+)$/.exec(u.pathname);
    if (method === "GET" && pm) {
      const card = this.brands.get(pm[1]);
      return card ? json(200, { id: pm[1], type: "card", card: { ...card, exp_month: 1, exp_year: 2030 } }) : missing();
    }
    return json(404, { error: { type: "invalid_request_error", message: "unknown route" } });
  }) as typeof fetch;
}
