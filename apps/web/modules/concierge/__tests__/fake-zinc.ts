// A fake Zinc HTTP API for tests against the real local database (E5: fake only what we don't own).
// Shared by purchase.test.ts and round-engine.test.ts.

// ─── fake Zinc ──────────────────────────────────────────────────────────────

export type Behavior = "ok" | "402" | "timeout" | { status: number; code: string };
type Post = { ref: string; idem: string; maxPrice: number; url: string; city: string; key: string };

export class FakeZinc {
  balance = 100_000;
  /** Zinc's orders, by our reference (metadata.order_id). */
  orders = new Map<string, { id: string; status: string; job_result?: unknown }>();
  /** Behaviors by product URL, used in turn; the last one repeats. */
  plan = new Map<string, Behavior[]>();
  posts: Post[] = [];
  calls: string[] = [];
  /** When set, POSTs wait on it (to hold a lease open). */
  gate: Promise<void> | null = null;
  onPost: (() => void) | null = null;

  private next(url: string): Behavior {
    const list = this.plan.get(url);
    if (!list?.length) return "ok";
    return list.length > 1 ? list.shift()! : list[0];
  }

  /** Only our own test users' keys work; anyone else's rows in the shared database get a 401. */
  constructor(private known: (key: string) => boolean) {}

  fetch = (async (input: string, init?: RequestInit) => {
    const u = new URL(input);
    const method = init?.method ?? "GET";
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "").replace("Bearer ", "");
    if (!this.known(auth)) return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
    this.calls.push(`${method} ${u.pathname}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (method === "GET" && u.pathname === "/wallet/me") return json(200, { spendable_balance: this.balance });
    if (method === "GET" && u.pathname === "/orders") {
      const o = this.orders.get(u.searchParams.get("metadata_value") ?? "");
      return json(200, { orders: o ? [o] : [] });
    }
    if (method === "POST" && u.pathname === "/orders") {
      const body = JSON.parse(String(init?.body));
      const key = auth;
      const ref = body.metadata.order_id as string;
      const url = body.products[0].url as string;
      this.posts.push({ ref, idem: body.idempotency_key, maxPrice: body.max_price, url, city: body.shipping_address.city, key });
      this.onPost?.();
      if (this.gate) await this.gate;
      const b = this.next(url);
      if (b === "timeout") throw new TypeError("network down");
      if (b === "402") {
        return json(402, { error: { code: "insufficient_funds", details: { required: body.max_price + 100, available: this.balance } } });
      }
      if (b !== "ok") return json(b.status, { error: { code: b.code } });
      const id = `zn_${this.orders.size + 1}_${ref.slice(0, 8)}`;
      this.orders.set(ref, { id, status: "processing" });
      return json(200, { id });
    }
    return json(404, { error: { code: "not_found" } });
  }) as unknown as typeof fetch;
}

