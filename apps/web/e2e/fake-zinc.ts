import { createServer, type Server } from "node:http";

// A stand-in for Zinc's API for the browser tests (ALL-32): the device-code sign-in, the wallet,
// and our webhook endpoint. It listens on a fixed port, which playwright.config.ts passes to the
// app as ZINC_API_BASE. The tests play the part of "the user clicks Allow at Zinc" through two
// control routes: POST /__approve?user_code=… and GET /__state.
export const FAKE_ZINC_PORT = 4599;
export const FAKE_ZINC_URL = `http://127.0.0.1:${FAKE_ZINC_PORT}`;
export const FAKE_ZINC_KEY = "zn_live_E2E_FAKE_KEY";

type State = { issued: number; approved: Set<string>; webhook: string | null; webhookCleared: number };

export function startFakeZinc(): Promise<Server> {
  const state: State = { issued: 0, approved: new Set(), webhook: null, webhookCleared: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", FAKE_ZINC_URL);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>) : {};
      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      const route = `${req.method} ${url.pathname}`;

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
      if (route === "GET /wallet/me") return send(200, { spendable_balance: 4000 });
      if (route === "POST /sandbox/keys") return send(201, { api_key: "zn_test_E2E_FAKE_KEY" });
      if (route === "POST /__approve") {
        state.approved.add(url.searchParams.get("user_code") ?? "");
        return send(200, {});
      }
      if (route === "GET /__state") return send(200, { webhook: state.webhook, webhookCleared: state.webhookCleared });
      if (route === "GET /activate") return send(200, { page: "Zinc" });
      return send(404, { error: { code: "not_found" } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_ZINC_PORT, "127.0.0.1", () => resolve(server));
  });
}
