import { createServer, type Server } from "node:http";
import { FAKE_IDEAS } from "./fake-gateway";

// A stand-in for Zinc's API for the browser tests (ALL-32): the device-code sign-in, the wallet,
// and our webhook endpoint. It listens on a fixed port, which playwright.config.ts passes to the
// app as ZINC_API_BASE. The tests play the part of "the user clicks Allow at Zinc" through two
// control routes: POST /__approve?user_code=… and GET /__state. For the idea engine (ALL-27) it
// also answers product search and offers on the app's key, from fake-gateway.ts's FAKE_IDEAS.
// For the approval journeys (ALL-29) it prices FAKE_PRODUCTS (offers and details, with a photo),
// answers the store check, takes orders on any key, and refuses an order whose max_price is
// below the product's price, as Zinc does. GET /__calls?match=… counts the calls whose
// method, path, query or key contain the text, so a test can tell that loading a page called nothing.
export const FAKE_ZINC_PORT = 4599;
export const FAKE_ZINC_URL = `http://127.0.0.1:${FAKE_ZINC_PORT}`;
export const FAKE_ZINC_KEY = "zn_live_E2E_FAKE_KEY";
/** The app's own key for product lookups (ZINC_API_KEY). */
export const FAKE_ZINC_APP_KEY = "zn_live_E2E_FAKE_APP_KEY";

type FakeProduct = { retailer: string; productId: string; url: string; title: string; priceCents: number; image?: string; orderError?: string };

/**
 * Products the approval journeys price and buy, each used by one journey only. Any other product
 * link is ordered without a price check.
 */
export const FAKE_PRODUCTS = {
  /** Bought at a total under its price, so the order fails price_up; today's price is this. */
  priceUp: { retailer: "amazon", productId: "B0E2EPRICE", url: "https://www.amazon.com/dp/B0E2EPRICE", title: "Cedar fly box", priceCents: 3000 },
  /** Zinc says it's out of stock when it's ordered. */
  soldOut: {
    retailer: "amazon",
    productId: "B0E2ESOLD1",
    url: "https://www.amazon.com/dp/B0E2ESOLD1",
    title: "Brass fly reel",
    priceCents: 1500,
    orderError: "out_of_stock",
  },
  /** List gifts: one from Amazon (offers, then its photo from the details), one from Etsy (details). */
  listAmazon: {
    retailer: "amazon",
    productId: "B0E2ELIST1",
    url: "https://www.amazon.com/dp/B0E2ELIST1",
    title: "Waxed canvas tote",
    priceCents: 2200,
    image: "https://images.e2e.test/tote.jpg",
  },
  listEtsy: {
    retailer: "etsy",
    productId: "1234567890",
    url: "https://www.etsy.com/listing/1234567890/hand-thrown-mug",
    title: "Hand-thrown mug",
    priceCents: 3400,
    image: "https://images.e2e.test/mug.jpg",
  },
} satisfies Record<string, FakeProduct>;

const PRODUCTS: FakeProduct[] = Object.values(FAKE_PRODUCTS);

/** The one store link Zinc only checks and says it will try (GET /retailers/check). It says no to any other. */
export const FAKE_CHECKABLE_URL = "https://www.rei.com/product/220011/e2e-camp-mug";

/** One new, in-stock offer from Amazon itself: free shipping, here within a week. */
function offerFor(priceCents: number) {
  return {
    offer_id: "e2e-offer",
    price: priceCents,
    available: true,
    condition: "New",
    buy_box_winner: true,
    seller: { name: "Amazon.com", first_party: true },
    handling_days: { max: 1 },
    shipping_options: [{ price: 0, delivery_days: { min: 2, max: 4 } }],
  };
}

type State = {
  issued: number;
  approved: Set<string>;
  webhook: string | null;
  webhookCleared: number;
  /** Every call, as "METHOD /path?query key", for GET /__calls. */
  calls: string[];
  /** Orders taken: Zinc's id by our reference (metadata.order_id). */
  orders: Map<string, string>;
};

export function startFakeZinc(): Promise<Server> {
  const state: State = { issued: 0, approved: new Set(), webhook: null, webhookCleared: 0, calls: [], orders: new Map() };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", FAKE_ZINC_URL);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const json: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const body = json as Record<string, string>;
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      const route = `${req.method} ${url.pathname}`;
      if (!url.pathname.startsWith("/__")) state.calls.push(`${route}${url.search} ${req.headers.authorization ?? ""}`);
      const appKey = req.headers.authorization === `Bearer ${FAKE_ZINC_APP_KEY}`;

      if (route === "POST /device/code") {
        const n = ++state.issued;
        const code = `E2E${String(n).padStart(2, "0")}-4M2P`;
        return send(200, {
          device_code: `device-${code}`,
          user_code: code,
          verification_uri: `${FAKE_ZINC_URL}/activate`,
          verification_uri_complete: `${FAKE_ZINC_URL}/activate?c=${code}`,
          expires_in: 900,
          interval: 1,
        });
      }
      if (route === "POST /device/token") {
        const userCode = String(body.device_code ?? "").replace(/^device-/, "");
        return state.approved.has(userCode)
          ? send(200, { key: FAKE_ZINC_KEY })
          : send(400, { error: { code: "authorization_pending", message: "waiting" } });
      }
      if (route === "PUT /webhooks/endpoint") {
        state.webhook = body.url ?? null;
        return send(200, { webhook_secret: "zn_whsec_E2E_FAKE_SECRET" });
      }
      if (route === "DELETE /webhooks/endpoint") {
        state.webhookCleared++;
        return send(204);
      }
      if (route === "GET /products/search") {
        if (req.headers.authorization !== `Bearer ${FAKE_ZINC_APP_KEY}`) return send(401, { error: { code: "unauthorized" } });
        const found = FAKE_IDEAS.filter((i) => i.search === url.searchParams.get("query"));
        return send(200, { results: found.map((i) => ({ product_id: i.productId, title: i.productTitle, price: i.priceCents })) });
      }
      const offers = /^GET \/products\/([^/]+)\/offers$/.exec(route);
      if (offers) {
        if (!appKey) return send(401, { error: { code: "unauthorized" } });
        const id = decodeURIComponent(offers[1]);
        const price =
          FAKE_IDEAS.find((i) => i.productId === id)?.priceCents ??
          PRODUCTS.find((p) => p.productId === id && p.retailer === url.searchParams.get("retailer"))?.priceCents;
        return price !== undefined ? send(200, { offers: [offerFor(price)] }) : send(404, { error: { code: "not_found" } });
      }
      const details = /^GET \/products\/([^/]+)$/.exec(route);
      if (details && url.pathname !== "/products/search") {
        if (!appKey) return send(401, { error: { code: "unauthorized" } });
        const id = decodeURIComponent(details[1]);
        const p = PRODUCTS.find((x) => x.productId === id && x.retailer === url.searchParams.get("retailer"));
        if (!p) return send(404, { error: { code: "not_found" } });
        return send(200, { status: "completed", product_id: p.productId, title: p.title, price: p.priceCents, main_image: p.image ?? null });
      }
      if (route === "GET /retailers/check") {
        if (!appKey) return send(401, { error: { code: "unauthorized" } });
        return send(200, { orderable: url.searchParams.get("url") === FAKE_CHECKABLE_URL });
      }
      if (route === "POST /orders") {
        // On the buyer's own key, whatever it is. Like Zinc, an order capped below the price is refused.
        const order = json as { products: { url: string }[]; max_price: number; metadata: { order_id: string } };
        const p = PRODUCTS.find((x) => x.url === order.products[0]?.url);
        if (p?.orderError) return send(400, { error: { code: p.orderError } });
        if (p && order.max_price < p.priceCents) return send(400, { error: { code: "max_price_exceeded" } });
        const id = `zn_e2e_${state.orders.size + 1}`;
        state.orders.set(order.metadata.order_id, id);
        return send(200, { id });
      }
      if (route === "GET /orders") {
        const id = state.orders.get(url.searchParams.get("metadata_value") ?? "");
        return send(200, { orders: id ? [{ id, status: "processing" }] : [] });
      }
      if (route === "GET /wallet/me") return send(200, { spendable_balance: 4000 });
      if (route === "POST /sandbox/keys") return send(201, { api_key: "zn_test_E2E_FAKE_KEY" });
      if (route === "POST /__approve") {
        state.approved.add(url.searchParams.get("user_code") ?? "");
        return send(200, {});
      }
      if (route === "GET /__state") return send(200, { webhook: state.webhook, webhookCleared: state.webhookCleared });
      if (route === "GET /__calls") {
        const match = url.searchParams.get("match") ?? "";
        return send(200, { count: state.calls.filter((c) => match !== "" && c.includes(match)).length });
      }
      if (route === "GET /activate") return send(200, { page: "Zinc" });
      return send(404, { error: { code: "not_found" } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_ZINC_PORT, "127.0.0.1", () => resolve(server));
  });
}
