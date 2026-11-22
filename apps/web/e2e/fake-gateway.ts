import { createServer, type Server } from "node:http";
import { AI_MODELS } from "../lib/ai/models";

// A stand-in for the AI Gateway for the browser tests (ALL-27), so no test spends money.
// It answers GET /v1/models with a priced entry for the ideas model (a run reads prices
// first), and POST /v1/messages with a canned brainstorm (the body has tools) or a canned
// rank (no tools), in the shapes lib/ai/ideas.ts reads, with usage so the cost is counted.
// The products are synthetic; fake-zinc.ts finds each one by its search text.
export const FAKE_GATEWAY_PORT = 4598;
export const FAKE_GATEWAY_URL = `http://127.0.0.1:${FAKE_GATEWAY_PORT}`;
export const FAKE_GATEWAY_KEY = "gw-e2e-fake-key";

/**
 * The ideas the brainstorm suggests, with the product each search finds and the reason the rank
 * gives. No search holds a word of a test person's or buyer's name ("E2E", "Round", "Engine"):
 * the run drops such a search before it reaches Zinc (AC-21).
 */
export const FAKE_IDEAS = [
  {
    title: "Rotary fly-tying vise",
    search: "rotary fly tying vise",
    productId: "B0E2EVISE1",
    productTitle: "Streamside Rotary Fly Tying Vise",
    priceCents: 2499,
    reason: "They asked for a new vise, and this one turns as they tie.",
  },
  {
    title: "Waterproof fly box",
    search: "waterproof fly box",
    productId: "B0E2EBOX01",
    productTitle: "Streamside Waterproof Fly Box",
    priceCents: 1599,
    reason: "Keeps the flies they tie dry on the river.",
  },
  {
    title: "Fly line cleaning kit",
    search: "fly line cleaning kit",
    productId: "B0E2ELINE1",
    productTitle: "Streamside Fly Line Cleaning Kit",
    priceCents: 1299,
    reason: "A small kit that keeps their line casting smoothly.",
  },
] as const;

const USAGE = { input_tokens: 1200, output_tokens: 400 };

function brainstormReply() {
  const ideas = FAKE_IDEAS.map((i) => ({ title: i.title, search: i.search, brand: null, why: i.reason }));
  return {
    content: [{ type: "text", text: JSON.stringify({ ideas }) }],
    usage: { ...USAGE, server_tool_use: { web_search_requests: 2 } },
  };
}

/** Ranks every option it was given, in order, with the reason for its product. */
function rankReply(prompt: string) {
  const order = [...prompt.matchAll(/- id (\S+): (.+?), \$/g)].map(([, id, title]) => ({
    id,
    reason: FAKE_IDEAS.find((i) => i.productTitle === title)?.reason ?? "A good fit.",
  }));
  return { content: [{ type: "text", text: JSON.stringify({ order }) }], usage: USAGE };
}

export function startFakeGateway(): Promise<Server> {
  // Every message body, for GET /__calls?match=… (how many asked about this text): the approval
  // journeys check a run with enough list gifts makes no AI call (ALL-29 AC-28).
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const route = `${req.method} ${new URL(req.url ?? "/", FAKE_GATEWAY_URL).pathname}`;
      if (route === "GET /v1/models") {
        // Dollars per token, and per 1,000 searches, as the real listing gives them.
        return send(200, { data: [{ id: AI_MODELS.ideas, pricing: { input: "0.000003", output: "0.000015", web_search: "10" } }] });
      }
      if (route === "GET /__calls") {
        const match = new URL(req.url ?? "/", FAKE_GATEWAY_URL).searchParams.get("match") ?? "";
        return send(200, { count: bodies.filter((b) => match !== "" && b.includes(match)).length });
      }
      if (route === "POST /v1/messages") {
        if (req.headers["x-api-key"] !== FAKE_GATEWAY_KEY) return send(401, { error: "unauthorized" });
        bodies.push(Buffer.concat(chunks).toString());
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { tools?: unknown[]; messages: { content: string }[] };
        return send(200, body.tools ? brainstormReply() : rankReply(body.messages[0].content));
      }
      return send(404, { error: "not_found" });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_GATEWAY_PORT, "127.0.0.1", () => resolve(server));
  });
}
