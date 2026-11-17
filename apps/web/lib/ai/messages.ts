import { z } from "zod";

// The Gateway's Anthropic-compatible /v1/messages, called over plain HTTP because
// the AI SDK has no route for Anthropic's server-side web_search (ALL-27,
// design/spikes/ai.md > "ALL-27 shapes"). Callers pass in everything this uses (E3).

export type GatewayHttp = { base: string; apiKey: string; fetch: typeof fetch };

/** Prices in cents: per token for input and output, per search for web search. */
export type GatewayPrices = { inputCentsPerToken: number; outputCentsPerToken: number; searchCents: number };

/** The message is always a fixed phrase: never request or response text (T42, S5). */
export class AiError extends Error {
  /** What a reply we received and priced cost before it failed, so the caller still counts it. A number, never text. */
  constructor(
    public kind: "unavailable" | "malformed",
    public costCents?: number,
  ) {
    super(kind === "unavailable" ? "AI request failed" : "AI reply was not understood");
    this.name = "AiError";
  }
}

async function call(h: GatewayHttp, path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await h.fetch(`${h.base}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AiError("unavailable");
  }
  if (!res.ok) throw new AiError("unavailable");
  try {
    return await res.json();
  } catch {
    throw new AiError("malformed");
  }
}

const modelsReply = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      pricing: z.object({ input: z.unknown(), output: z.unknown(), web_search: z.unknown() }).partial().optional(),
    }),
  ),
});

function price(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Reads the free GET /v1/models listing: dollars per token, and dollars per 1,000 searches. */
export async function gatewayPrices(h: GatewayHttp, model: string, signal: AbortSignal): Promise<GatewayPrices> {
  const parsed = modelsReply.safeParse(await call(h, "/v1/models", { signal }));
  if (!parsed.success) throw new AiError("malformed");
  const p = parsed.data.data.find((m) => m.id === model)?.pricing;
  // A missing, empty, null or zero price must never read as free, or the cost cap is defeated.
  const input = price(p?.input);
  const output = price(p?.output);
  const search = price(p?.web_search);
  if (input === null || output === null || search === null) throw new AiError("unavailable");
  return { inputCentsPerToken: input * 100, outputCentsPerToken: output * 100, searchCents: (search * 100) / 1000 };
}

const messagesReply = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    server_tool_use: z.object({ web_search_requests: z.number() }).partial().optional(),
  }),
});

/** Sends one message; returns the last text block and what the call cost in cents. */
export async function sendMessages(
  h: GatewayHttp,
  body: object,
  prices: GatewayPrices,
  signal: AbortSignal,
): Promise<{ text: string; costCents: number }> {
  const json = await call(h, "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": h.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const parsed = messagesReply.safeParse(json);
  if (!parsed.success) throw new AiError("malformed");
  const texts = parsed.data.content.filter((b) => b.type === "text" && b.text !== undefined);
  const text = texts.at(-1)?.text;
  const u = parsed.data.usage;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const costCents =
    u.input_tokens * prices.inputCentsPerToken + u.output_tokens * prices.outputCentsPerToken + searches * prices.searchCents;
  if (text === undefined) throw new AiError("malformed", costCents);
  return { text, costCents };
}
