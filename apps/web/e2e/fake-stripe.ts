import { createServer, type Server } from "node:http";
import { checkoutParamRefusal, versionRefusal } from "../test/fake-stripe-contract";

// A stand-in for Stripe for the browser tests (ALL-98): just what stripe/card.ts calls (customers,
// setup-mode Checkout Sessions, a customer's cards, reading and detaching a card) and Stripe's
// own card page. playwright.config.ts points the app at it with STRIPE_API_BASE. The card page
// at /pay/<session id> has two links, the way a buyer leaves Stripe's page: "Save card", which
// attaches a test Visa ending 4242 and sends the buyer to the session's success_url, and "Back",
// which sends them to its cancel_url with nothing saved. GET /__requests?path=… counts calls.
export const FAKE_STRIPE_PORT = 4597;
export const FAKE_STRIPE_URL = `http://127.0.0.1:${FAKE_STRIPE_PORT}`;
/** A live-looking key, since the app runs with ZINC_ENV=live; it only ever reaches this fake. */
export const FAKE_STRIPE_KEY = "sk_live_E2E_FAKE_STRIPE";

type Session = {
  id: string;
  status: "open" | "complete";
  customer: string;
  success_url: string;
  cancel_url: string;
  payment_method: string | null;
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function startFakeStripe(): Promise<Server> {
  const customers = new Map<string, string[]>();
  const byIdem = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const brands = new Map<string, { brand: string; last4: string }>();
  const requests: string[] = [];
  let n = 0;
  const id = (prefix: string) => `${prefix}_live_e2e${++n}${Math.random().toString(36).slice(2, 8)}`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", FAKE_STRIPE_URL);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const route = `${req.method} ${url.pathname}`;
      if (!url.pathname.startsWith("/__") && !url.pathname.startsWith("/pay/")) requests.push(route);
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const redirect = (to: string) => {
        res.writeHead(303, { Location: to });
        res.end();
      };
      const missing = () => send(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
      const api = !url.pathname.startsWith("/__") && !url.pathname.startsWith("/pay/");
      if (api && req.headers.authorization !== `Bearer ${FAKE_STRIPE_KEY}`) return send(401, { error: { code: "api_key_invalid" } });
      // What real Stripe would refuse: an unpinned or too-old API version, an unknown session parameter.
      const version = api ? versionRefusal(req.headers["stripe-version"] as string | undefined) : null;
      if (version) return send(version.status, version.body);

      if (route === "POST /v1/customers") {
        const idem = req.headers["idempotency-key"];
        const known = typeof idem === "string" ? byIdem.get(idem) : undefined;
        if (known) return send(200, { id: known });
        const c = id("cus");
        customers.set(c, []);
        if (typeof idem === "string") byIdem.set(idem, c);
        return send(200, { id: c });
      }
      if (route === "POST /v1/checkout/sessions") {
        const unknown = checkoutParamRefusal(body);
        if (unknown) return send(unknown.status, unknown.body);
        const s: Session = {
          id: id("cs"),
          status: "open",
          customer: body.get("customer") ?? "",
          success_url: body.get("success_url") ?? "",
          cancel_url: body.get("cancel_url") ?? "",
          payment_method: null,
        };
        sessions.set(s.id, s);
        return send(200, { id: s.id, url: `${FAKE_STRIPE_URL}/pay/${s.id}` });
      }
      const session = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && session) {
        const s = sessions.get(session[1]);
        if (!s) return missing();
        return send(200, {
          id: s.id,
          status: s.status,
          mode: "setup",
          livemode: true,
          customer: s.customer,
          setup_intent: s.payment_method ? { id: `seti_${s.id}`, status: "succeeded", usage: "off_session", payment_method: s.payment_method } : null,
        });
      }
      const list = /^\/v1\/customers\/([^/]+)\/payment_methods$/.exec(url.pathname);
      if (req.method === "GET" && list) {
        const cards = customers.get(list[1]);
        return cards ? send(200, { has_more: false, data: cards.map((c) => ({ id: c })) }) : missing();
      }
      const detach = /^\/v1\/payment_methods\/([^/]+)\/detach$/.exec(url.pathname);
      if (req.method === "POST" && detach) {
        for (const [c, cards] of customers) customers.set(c, cards.filter((x) => x !== detach[1]));
        return send(200, { id: detach[1] });
      }
      const pm = /^\/v1\/payment_methods\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && pm) {
        const card = brands.get(pm[1]);
        return card ? send(200, { id: pm[1], card }) : missing();
      }

      // Stripe's card page, as a buyer sees it.
      const page = /^\/pay\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && page) {
        const s = sessions.get(page[1]);
        if (!s) return missing();
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(
          `<!doctype html><title>Stripe (fake)</title><h1>Save a card for gifts</h1>` +
            `<a href="/pay/${escape(s.id)}/save">Save card</a> <a href="/pay/${escape(s.id)}/back">Back</a>`,
        );
      }
      const done = /^\/pay\/([^/]+)\/(save|back)$/.exec(url.pathname);
      if (req.method === "GET" && done) {
        const s = sessions.get(done[1]);
        if (!s) return missing();
        const fill = (to: string) => to.replace("{CHECKOUT_SESSION_ID}", s.id);
        if (done[2] === "back") return redirect(fill(s.cancel_url));
        const card = id("pm");
        brands.set(card, { brand: "visa", last4: "4242" });
        customers.set(s.customer, [...(customers.get(s.customer) ?? []), card]);
        s.status = "complete";
        s.payment_method = card;
        return redirect(fill(s.success_url));
      }
      if (route === "GET /__requests") {
        const path = url.searchParams.get("path") ?? "";
        return send(200, { count: requests.filter((r) => path !== "" && r.includes(path)).length });
      }
      return send(404, { error: { type: "invalid_request_error", message: "unknown route" } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_STRIPE_PORT, "127.0.0.1", () => resolve(server));
  });
}
