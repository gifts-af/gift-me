import { z } from "zod";
import { AI_MODELS } from "./models";
import { AiError, sendMessages, type GatewayHttp, type GatewayPrices } from "./messages";

// Gift ideas in two steps (ALL-27): brainstorm with web search, then rank.
// Prompts are v3 from the ALL-17 spike (design/spikes/ai.md), with two changes:
// ids are assigned here, and the AI names the maker as `brand`. Number settings
// arrive as arguments (T23). The AI is never given a name, email or address (T42).

export type IdeaCandidate = { id: string; title: string; search: string; brand: string | null; why: string };

export type BrainstormInput = {
  /** How the buyer knows them, e.g. "father". Never their name. */
  relationship: string;
  occasion: string | null;
  budgetCents: number | null;
  facts: string[];
  avoidTitles: string[];
};

export type RankInput = {
  relationship: string;
  facts: string[];
  options: { id: string; title: string; totalCents: number; fit: "within" | "over" }[];
};

const brainstormSystem = (candidates: number, overBudgetPct: number) => `You are a thoughtful gift concierge. You get a profile of one person and the occasion.
Use web search to check that ideas are real, currently sold, and fit the budget.
Propose ${candidates} distinct gift concepts that this specific person would be glad to receive.

Rules:
- Grounded in the profile: each idea relies on the facts given.
- Not something they already own or said they dislike. Respect every constraint.
- Don't repeat any idea listed under "Already suggested".
- Physical items that can be bought online and shipped (Amazon, Walmart, Target, Best Buy, or a brand's own store).
- Price including likely shipping within the budget, except at most one idea up to ${overBudgetPct}% over.
- Prefer one great, specific thing over generic gift baskets or novelty items.
- Stock items only: no personalization, engraving or made-to-order.
- Strongly prefer Amazon, Walmart, Target or Best Buy. Use a brand's own store only if the item isn't sold at those.
- Facts marked (captured) came from the person's own posts and saves. Weigh "wants" and "owns" facts most:
  a stated need beats a general interest, and never suggest something they already own.
- Stay inside the stated interests; don't stretch them into related hobbies the person never mentioned.
- Stated wants come first. If the facts include "wants", at least 2 ideas must directly meet those wants.
  If the item they want usually costs more than the budget, use your one over-budget idea on it, or find the best version within budget.
- "owns" means don't buy a duplicate. But if something they own is worn out, broken or used up, replacing it is a top idea.
  Before suggesting anything, check it against every "owns" fact (a kettle is a kettle, even a fancier one).
- "Ships to" is only the delivery address. Don't assume their hobbies happen there.

Return JSON only: {"ideas": [{"title", "search", "brand", "why"}]}.
"search" is the exact text to search for at the retailer (brand and model when known).
"brand" is the maker's name, or null when there isn't one.
Don't invent product URLs.`;

const rankSystem = (keepMin: number, keepMax: number) => `You pick the best gifts from a list of options for one person.
Put the options in order, best first, and keep the top ${keepMin} to ${keepMax}. Drop anything generic, risky, or weakly grounded.
An option marked "over" is over the budget: keep it only if it is clearly the best fit.
For each kept option write a one-line reason a busy adult would read on a phone,
in plain words, starting with the person's connection to it (e.g. "His old vise just died...").
Return JSON only: {"order": [{"id", "reason"}]}, using only the ids you were given.`;

// Text taken from web results comes wrapped in <cite index="..."> tags.
// Only cite tags: \b keeps a word like <citation> in the text.
const stripCites = (s: string) => s.replace(/<\/?cite\b[^>]*>/g, "").trim();

// Models sometimes wrap JSON in prose or a fence. Try the whole text, then a
// fenced block, then the outermost braces (both replies are objects).
function parseJson(text: string): unknown {
  const t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t)?.[1];
  const braces = t.indexOf("{") >= 0 && t.lastIndexOf("}") > t.indexOf("{") ? t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1) : undefined;
  for (const candidate of [t, fenced, braces]) {
    if (candidate === undefined) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next form
    }
  }
  throw new AiError("malformed");
}

/** Parses a reply we already paid for; if it's unreadable, the error carries the cost. */
function readReply<T>(text: string, costCents: number, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = parseJson(text);
  } catch {
    throw new AiError("malformed", costCents);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError("malformed", costCents);
  return parsed.data;
}

const ideaSchema = z.object({
  title: z.string().min(1),
  search: z.string().min(1),
  brand: z.string().nullable().optional(),
  why: z.string().min(1),
});
const brainstormReply = z.object({ ideas: z.array(z.unknown()) });
const rankReply = z.object({ order: z.array(z.object({ id: z.string(), reason: z.string() })) });

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function brainstorm(
  h: GatewayHttp,
  input: BrainstormInput,
  o: { candidates: number; maxSearches: number; maxTokens: number; overBudgetPct: number; prices: GatewayPrices; signal: AbortSignal },
): Promise<{ candidates: IdeaCandidate[]; costCents: number }> {
  const user = [
    `Occasion: ${input.occasion ?? "none given"}`,
    `Budget: ${input.budgetCents === null ? "none given" : dollars(input.budgetCents)}`,
    `Buying for their ${input.relationship}.`,
    "Facts:",
    ...input.facts.map((f) => `- ${f}`),
    ...(input.avoidTitles.length ? ["Already suggested:", ...input.avoidTitles.map((t) => `- ${t}`)] : []),
  ].join("\n");
  const { text, costCents } = await sendMessages(
    h,
    {
      model: AI_MODELS.ideas,
      max_tokens: o.maxTokens,
      system: brainstormSystem(o.candidates, o.overBudgetPct),
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: o.maxSearches }],
      messages: [{ role: "user", content: user }],
    },
    o.prices,
    o.signal,
  );
  const reply = readReply(text, costCents, brainstormReply);
  const candidates: IdeaCandidate[] = [];
  for (const raw of reply.ideas) {
    const idea = ideaSchema.safeParse(raw);
    if (!idea.success) continue;
    const search = stripCites(idea.data.search);
    // Nothing left to search for once the tags are gone.
    if (!search) continue;
    candidates.push({
      id: `c${candidates.length + 1}`,
      title: stripCites(idea.data.title),
      search,
      brand: idea.data.brand ? stripCites(idea.data.brand) || null : null,
      why: stripCites(idea.data.why),
    });
  }
  return { candidates, costCents };
}

function rankUserText(input: RankInput): string {
  return [
    `Buying for their ${input.relationship}.`,
    "Facts:",
    ...input.facts.map((f) => `- ${f}`),
    "Options:",
    ...input.options.map((p) => `- id ${p.id}: ${p.title}, ${dollars(p.totalCents)} delivered (${p.fit} budget)`),
  ].join("\n");
}

/**
 * The most input tokens a rank call can use: its prompt's size in UTF-8 bytes. A token is
 * never less than one byte, so this is a true upper bound (S3), with no ratio to tune.
 */
export function rankInputTokensMax(input: RankInput, keep: { keepMin: number; keepMax: number }): number {
  return new TextEncoder().encode(rankSystem(keep.keepMin, keep.keepMax) + rankUserText(input)).length;
}

export async function rank(
  h: GatewayHttp,
  input: RankInput,
  o: { maxTokens: number; keepMin: number; keepMax: number; prices: GatewayPrices; signal: AbortSignal },
): Promise<{ order: { id: string; reason: string }[]; costCents: number }> {
  const { text, costCents } = await sendMessages(
    h,
    {
      model: AI_MODELS.ideas,
      max_tokens: o.maxTokens,
      system: rankSystem(o.keepMin, o.keepMax),
      messages: [{ role: "user", content: rankUserText(input) }],
    },
    o.prices,
    o.signal,
  );
  const reply = readReply(text, costCents, rankReply);
  const given = new Set(input.options.map((p) => p.id));
  const order = reply.order
    .filter((r) => given.has(r.id))
    .map((r) => ({ id: r.id, reason: stripCites(r.reason) }));
  return { order, costCents };
}

/** The most a rank call can cost: every input token plus a full reply. Rank has no tools, so no searches. */
export function rankWorstCents(prices: GatewayPrices, maxTokens: number, inputTokens: number): number {
  return inputTokens * prices.inputCentsPerToken + maxTokens * prices.outputCentsPerToken;
}
