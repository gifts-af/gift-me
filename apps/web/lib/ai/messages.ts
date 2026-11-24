import { z } from "zod";

// The Gateway's Anthropic-compatible /v1/messages, called over plain HTTP because
// the AI SDK has no route for Anthropic's server-side web_search (ALL-27,
// design/spikes/ai.md > "ALL-27 shapes"). Callers pass in everything this uses (E3).

export type GatewayHttp = { base: string; apiKey: string; fetch: typeof fetch };

/** Prices in cents: per token for input and output, per search for web search. */
export type GatewayPrices = { inputCentsPerToken: number; outputCentsPerToken: number; searchCents: number };

const AI_ERROR_MESSAGES = {
  unavailable: "AI request failed",
  malformed: "AI reply was not understood",
  no_credit: "AI credit is used up",
} as const;

/**
 * The message is always a fixed phrase: never request or response text (T42, S5). `no_credit`:
 * the Gateway's credit ran out, so the AI call was refused and cost nothing.
 */
export class AiError extends Error {
  /**
   * `costCents`: what a reply we received and priced cost before it failed, so the caller still
   * counts it. A number, never text. `maybeSpent`: the call may have been charged, but no reply
   * says how much. Never true for a refusal, or with `costCents`. `status`: the reply's HTTP status
   * when the Gateway refused the call; none when there was no reply.
   */
  constructor(
    public kind: keyof typeof AI_ERROR_MESSAGES,
    public costCents?: number,
    public maybeSpent = false,
    public status?: number,
  ) {
    super(AI_ERROR_MESSAGES[kind]);
    this.name = "AiError";
  }
}

/** HTTP 402: the Gateway sends both insufficient_funds and quota_for_entity_exceeded this way. */
const PAYMENT_REQUIRED = 402;

/** `paid`: the Gateway charges for this call, so one that fails without a readable answer may have spent. */
async function call(h: GatewayHttp, path: string, init: RequestInit, paid: boolean): Promise<unknown> {
  let res: Response;
  try {
    res = await h.fetch(`${h.base}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AiError("unavailable", undefined, paid);
  }
  if (res.status === PAYMENT_REQUIRED) throw new AiError("no_credit", undefined, false, res.status);
  if (!res.ok) throw new AiError("unavailable", undefined, false, res.status);
  try {
    return await res.json();
  } catch {
    throw new AiError("malformed", undefined, paid);
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
  const parsed = modelsReply.safeParse(await call(h, "/v1/models", { signal }, false));
  if (!parsed.success) throw new AiError("malformed");
  const p = parsed.data.data.find((m) => m.id === model)?.pricing;
  // A missing, empty, null or zero price must never read as free, or the cost cap is defeated.
  const input = price(p?.input);
  const output = price(p?.output);
  const search = price(p?.web_search);
  if (input === null || output === null || search === null) throw new AiError("unavailable");
  return { inputCentsPerToken: input * 100, outputCentsPerToken: output * 100, searchCents: (search * 100) / 1000 };
}

// The Gateway's credits reply, in dollars (gatewayCreditsResponseSchema in @ai-sdk/gateway).
const creditsReply = z.object({ balance: z.string(), total_used: z.string() });

/** Reads the free GET /v1/credits: the team's AI credit left, in whole cents. */
export async function gatewayCredits(h: GatewayHttp, signal: AbortSignal): Promise<{ balanceCents: number }> {
  const parsed = creditsReply.safeParse(
    await call(h, "/v1/credits", { headers: { Authorization: `Bearer ${h.apiKey}` }, signal }, false),
  );
  if (!parsed.success) throw new AiError("malformed");
  const dollars = parsed.data.balance.trim() === "" ? NaN : Number(parsed.data.balance);
  if (!Number.isFinite(dollars)) throw new AiError("malformed");
  return { balanceCents: Math.round(dollars * 100) };
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
  const init: RequestInit = {
    method: "POST",
    headers: { "x-api-key": h.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
  const parsed = messagesReply.safeParse(await call(h, "/v1/messages", init, true));
  if (!parsed.success) throw new AiError("malformed", undefined, true);
  const texts = parsed.data.content.filter((b) => b.type === "text" && b.text !== undefined);
  const text = texts.at(-1)?.text;
  const u = parsed.data.usage;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const costCents =
    u.input_tokens * prices.inputCentsPerToken + u.output_tokens * prices.outputCentsPerToken + searches * prices.searchCents;
  if (text === undefined) throw new AiError("malformed", costCents);
  return { text, costCents };
}
