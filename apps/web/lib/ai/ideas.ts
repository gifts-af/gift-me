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

const brainstormSystem = (candidates: number) => `You are a thoughtful gift concierge. You get a profile of one person and the occasion.
Use web search to check that ideas are real, currently sold, and fit the budget.
Propose ${candidates} distinct gift concepts that this specific person would be glad to receive.

Rules:
- Grounded in the profile: each idea relies on the facts given.
- Not something they already own or said they dislike. Respect every constraint.
- Don't repeat any idea listed under "Already suggested".
- Physical items that can be bought online and shipped (Amazon, Walmart, Target, Best Buy, or a brand's own store).
- Price including likely shipping within the budget, except at most one idea up to 15% over.
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

const RANK_SYSTEM = `You pick the best gifts from a list of options for one person.
Put the options in order, best first, and keep the top 3 to 5. Drop anything generic, risky, or weakly grounded.
An option marked "over" is over the budget: keep it only if it is clearly the best fit.
For each kept option write a one-line reason a busy adult would read on a phone,
in plain words, starting with the person's connection to it (e.g. "His old vise just died...").
Return JSON only: {"order": [{"id", "reason"}]}, using only the ids you were given.`;

// Text taken from web results comes wrapped in <cite index="..."> tags.
const stripCites = (s: string) => s.replace(/<\/?cite[^>]*>/g, "").trim();

// Models sometimes wrap JSON in prose or fences; take the outermost JSON value.
function parseJson(text: string): unknown {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end < start) throw new AiError("malformed");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError("malformed");
  }
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
  o: { candidates: number; maxSearches: number; maxTokens: number; prices: GatewayPrices; signal: AbortSignal },
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
      system: brainstormSystem(o.candidates),
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: o.maxSearches }],
      messages: [{ role: "user", content: user }],
    },
    o.prices,
    o.signal,
  );
  const parsed = brainstormReply.safeParse(parseJson(text));
  if (!parsed.success) throw new AiError("malformed");
  const candidates: IdeaCandidate[] = [];
  for (const raw of parsed.data.ideas) {
    const idea = ideaSchema.safeParse(raw);
    if (!idea.success) continue;
    candidates.push({
      id: `c${candidates.length + 1}`,
      title: stripCites(idea.data.title),
      search: idea.data.search.trim(),
      brand: idea.data.brand?.trim() || null,
      why: stripCites(idea.data.why),
    });
  }
  return { candidates, costCents };
}

export async function rank(
  h: GatewayHttp,
  input: RankInput,
  o: { maxTokens: number; prices: GatewayPrices; signal: AbortSignal },
): Promise<{ order: { id: string; reason: string }[]; costCents: number }> {
  const user = [
    `Buying for their ${input.relationship}.`,
    "Facts:",
    ...input.facts.map((f) => `- ${f}`),
    "Options:",
    ...input.options.map((p) => `- id ${p.id}: ${p.title}, ${dollars(p.totalCents)} delivered (${p.fit} budget)`),
  ].join("\n");
  const { text, costCents } = await sendMessages(
    h,
    { model: AI_MODELS.ideas, max_tokens: o.maxTokens, system: RANK_SYSTEM, messages: [{ role: "user", content: user }] },
    o.prices,
    o.signal,
  );
  const parsed = rankReply.safeParse(parseJson(text));
  if (!parsed.success) throw new AiError("malformed");
  const given = new Set(input.options.map((p) => p.id));
  const order = parsed.data.order
    .filter((r) => given.has(r.id))
    .map((r) => ({ id: r.id, reason: stripCites(r.reason) }));
  return { order, costCents };
}

/** The most a rank call can cost: every input token plus a full reply. Rank has no tools, so no searches. */
export function rankWorstCents(prices: GatewayPrices, maxTokens: number, inputTokens: number): number {
  return inputTokens * prices.inputCentsPerToken + maxTokens * prices.outputCentsPerToken;
}
