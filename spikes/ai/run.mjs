// Throwaway spike code for ALL-17 (W1-3). Not production code; prompts graduate to apps/web/lib/ai.
// Runs prompt v1 for the three AI tasks against the fixtures, through Vercel AI Gateway:
//   extract    captures -> candidate profile facts (C-3, C-8)
//   brainstorm profile -> ~8 gift concepts, with web search (G-1)
//   rank       concepts -> top 3-5 with one-line reasons (G-2)
// Writes every input, output, token count and cost to out/<task>.json.
//
// Usage: node spikes/ai/run.mjs [extract|ideas|all] [model]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const KEY = readFileSync(here('./.env'), 'utf8').match(/AI_GATEWAY_API_KEY=(\S+)/)[1];
const GATEWAY = 'https://ai-gateway.vercel.sh';
const MODEL = process.argv[3] ?? 'anthropic/claude-opus-5.5';
// Opus 5.5 list prices per token (from GET /v1/models), plus Anthropic web search per request.
const PRICE = { in: 0.000004, out: 0.00002, search: 0.01 };

const people = JSON.parse(readFileSync(here('./fixtures/people.json'), 'utf8'));
const captures = JSON.parse(readFileSync(here('./fixtures/captures.json'), 'utf8'));
mkdirSync(here('./out'), { recursive: true });

// Chat Completions: reports its own cost in usage.cost.
async function chat(system, user, effort = 'low') {
  const t0 = Date.now();
  const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      reasoning: { effort },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j)}`);
  return { text: j.choices[0].message.content, usage: j.usage, cost: j.usage.cost, secs: (Date.now() - t0) / 1000 };
}

// Anthropic Messages: needed for the native web search tool. Cost computed from usage.
async function messagesWithSearch(system, user, maxSearches) {
  const t0 = Date.now();
  const res = await fetch(`${GATEWAY}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: user }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j)}`);
  const text = j.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = j.usage;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const cost = u.input_tokens * PRICE.in + u.output_tokens * PRICE.out + searches * PRICE.search;
  return { text, usage: { input: u.input_tokens, output: u.output_tokens, searches }, cost, secs: (Date.now() - t0) / 1000 };
}

// Models sometimes wrap JSON in prose or fences; take the outermost JSON value.
function parseJson(text) {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return JSON.parse(text.slice(start, end + 1));
}

const EXTRACT_SYSTEM = `You help a gift-giving app learn what a specific person might like.
You get text the user captured from a web page or message about that person.
Return candidate facts as JSON: {"facts": [{"category", "value", "confidence", "evidence"}]}.

Categories: interest, dislike, size, brand, owns, wants, style, avoid, constraint.
- value: short and specific ("fly tying", "needs a new rotary vise", "film: Kodak Portra 400").
- confidence: 0 to 1. Lower it for jokes, guesses or things said in passing.
- evidence: the few words from the text that support it.
- "owns" and "wants" matter most: they stop duplicate gifts and point at real needs.

Never record or hint at sensitive traits: health or medical conditions, medications, pregnancy,
religion or religious practice, politics, sexuality, ethnicity, finances, or grief. If a sensitive
detail implies a practical gift constraint, record only the constraint in neutral words
(for example "prefers easy-open, large-grip items"), never the reason.
Record facts only about the person the capture is for, not about other people mentioned.
Return only the JSON.`;

const IDEAS_SYSTEM = `You are a thoughtful gift concierge. You get a profile of one person and the occasion.
Use web search to check that ideas are real, currently sold, and fit the budget.
Propose 8 distinct gift concepts that this specific person would be glad to receive.

Rules:
- Grounded in the profile: each idea cites the facts it relies on.
- Not something they already own or said they dislike. Respect every constraint.
- Physical items that can be bought online and shipped (Amazon, Walmart, Target, Best Buy, or a brand's own store).
- Price including likely shipping within the budget, except at most one idea up to 15% over.
- Prefer one great, specific thing over generic gift baskets or novelty items.
- v2: Stock items only: no personalization, engraving or made-to-order.
- v2: Strongly prefer Amazon, Walmart, Target or Best Buy. Use a brand's own store only if the item isn't sold at those.
- v2: Facts marked (captured) came from the person's own posts and saves. Weigh "wants" and "owns" facts most:
  a stated need beats a general interest, and never suggest something they already own.
- v2: Stay inside the stated interests; don't stretch them into related hobbies the person never mentioned.
- v3: Stated wants come first. If the facts include "wants", at least 2 ideas must directly meet those wants.
  If the item they want usually costs more than the budget, use your one over-budget idea on it, or find the best version within budget.
- v3: "owns" means don't buy a duplicate. But if something they own is worn out, broken or used up, replacing it is a top idea.
  Before suggesting anything, check it against every "owns" fact (a kettle is a kettle, even a fancier one).
- v3: "Ships to" is only the delivery address. Don't assume their hobbies happen there.

Return JSON only: {"ideas": [{"title", "product_search", "retailer_hint", "est_price_usd", "fits_facts": [..], "why"}]}.
"product_search" is the exact text to search for at the retailer (brand and model when known).
Don't invent product URLs.`;

const RANK_SYSTEM = `You pick the best gifts from a list of candidates for one person.
Rank them and keep the top 3 to 5. Drop anything generic, risky, or weakly grounded.
For each kept idea write a one-line reason a busy adult would read on a phone,
in plain words, starting with the person's connection to it (e.g. "His old vise just died...").
Return JSON only: {"ranked": [{"title", "reason", "score_0_10"}], "dropped": [{"title", "why"}]}.`;

async function runExtract() {
  const results = [];
  for (const c of captures) {
    const person = people.find((p) => p.id === c.person_id);
    const user = `Capture is about: ${person.name} (${person.relationship}).\nSource: ${c.page_title} (${c.source_url})\n\n${c.text_excerpt}`;
    const r = await chat(EXTRACT_SYSTEM, user, 'low');
    let facts;
    try { facts = parseJson(r.text).facts; } catch { facts = { parse_error: r.text }; }
    results.push({ capture: c.id, facts, tokens: r.usage.total_tokens, cost: r.cost, secs: r.secs });
    console.log(`extract ${c.id}: ${Array.isArray(facts) ? facts.length : '?'} facts, $${r.cost.toFixed(4)}, ${r.secs.toFixed(1)}s`);
  }
  writeFileSync(here('./out/extract.json'), JSON.stringify({ model: MODEL, results }, null, 2));
  return results;
}

// v2: the profile = hand-entered facts + facts extracted from captures (as if the user confirmed those with confidence >= 0.6).
function captured(personId) {
  let extract;
  try { extract = JSON.parse(readFileSync(here('./out/extract.json'), 'utf8')).results; } catch { return []; }
  const ids = captures.filter((c) => c.person_id === personId).map((c) => c.id);
  return extract.filter((r) => ids.includes(r.capture)).flatMap((r) => r.facts)
    .filter((f) => f.confidence >= 0.6).map((f) => `${f.category}: ${f.value} (captured)`);
}

async function runIdeas() {
  const results = [];
  const only = process.env.ONLY?.split(',');
  for (const p of people.filter((x) => !only || only.includes(x.id))) {
    const facts = [...p.facts, ...captured(p.id)];
    const profile = `Person: ${p.name} (${p.relationship}). Occasion: ${p.occasion}. Budget: $${p.budget_cents / 100} including shipping. Ships to: ${p.recipient_state}, USA.\nFacts:\n- ${facts.join('\n- ')}`;
    const b = await messagesWithSearch(IDEAS_SYSTEM, profile, 3);
    let ideas;
    try { ideas = parseJson(b.text).ideas; } catch { ideas = { parse_error: b.text }; }
    const r = await chat(RANK_SYSTEM, `${profile}\n\nCandidates:\n${JSON.stringify(ideas, null, 1)}`, 'low');
    let ranked;
    try { ranked = parseJson(r.text); } catch { ranked = { parse_error: r.text }; }
    results.push({ person: p.id, brainstorm: { ideas, ...b.usage, cost: b.cost, secs: b.secs }, rank: { ...ranked, tokens: r.usage.total_tokens, cost: r.cost, secs: r.secs } });
    console.log(`ideas ${p.id}: ${Array.isArray(ideas) ? ideas.length : '?'} ideas ($${b.cost.toFixed(3)}, ${b.secs.toFixed(0)}s, ${b.usage.searches} searches) -> ${ranked.ranked?.length ?? '?'} kept ($${r.cost.toFixed(3)})`);
  }
  writeFileSync(here(`./out/ideas-${process.env.RUN ?? 'v1'}.json`), JSON.stringify({ model: MODEL, results }, null, 2));
  return results;
}

const task = process.argv[2] ?? 'all';
if (task === 'extract' || task === 'all') await runExtract();
if (task === 'ideas' || task === 'all') await runIdeas();
