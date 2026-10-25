# Spike: AI capture extraction and gift ideas (W1-3, ALL-17)

Date started: 2026-10-25. Status: **done (core question answered).** Prompt v1–v3 tested on made-up fixtures. Follow-ups (screenshots, a cheaper model, resolving through Zinc, key rotation) are in **ALL-42**.

## Summary

- **Extraction works well and passed every sensitive-trait trap.** About **1¢ per capture**, 3–7 s.
- **Gift ideas are specific and grounded *when captured facts are included*.** Without them they're generic. With them, Dad's top idea is the vise he said broke. **Captures are the product's edge.**
- **Cost is higher than the design's estimate but within budget.** A full round (brainstorm with 3 searches, plus rank) costs **~$0.30–0.45**, against the design's ~$0.13. About a dozen rounds a month across 3 users is roughly $4–12, well inside the $60 cap.
- **The AI's prices and links aren't reliable.** Keep the resolve step: the AI returns a `product_search` string, and Zinc's search and offers confirm the item, price and URL.
- Spike spend: **$5.85** of gateway credit.

## Setup

- **Vercel AI Gateway works** on the Hobby plan, with no Pro needed. Getting there took three steps:
  1. A card on file. Vercel's personal scope and the separate **"GiftMe" team (`gift-me3`)** made this confusing.
  2. That unlocks $5 of free credit, but **free credit doesn't cover Claude models**.
  3. Buying **paid credit** (prepaid, not a subscription) unlocks them. The balance after the top-up was $25.
- **Model ID:** the gateway's ID is `anthropic/claude-opus-5.5` (with a dot). The design's `anthropic/claude-opus-5-5` is wrong. Always take IDs from `GET https://ai-gateway.vercel.sh/v1/models`.
- **Every response reports its own cost** (`usage.cost` on Chat Completions), so the spike measures real cost instead of estimating it.
- Key: `gift-concierge-ai-spike`, under allensforever711, in `spikes/ai/.env` (gitignored). Rotate it at the end of the spike; it was pasted into a Claude session.

## Web search through the gateway: confirmed

The design's **[Verify]** (§2.1, §7) is resolved. Anthropic's native web search tool (`web_search_20250305`) works through the gateway's Messages endpoint (`https://ai-gateway.vercel.sh/v1/messages`). In the AI SDK, it's `anthropic.tools.webSearch_20250305()` with a plain `anthropic/...` model string. The gateway also offers its own `gateway.tools.perplexitySearch()` as a provider-neutral option for the `searchWeb` step (T11).

| Test | Result |
|---|---|
| Opus 5.5, 1 search: "one fly-fishing gift under $60 on Amazon or Walmart" | 200 in 9.4 s. Found a fly-tying kit ($41.95) but **only linked to an Amazon best-seller list, not the product page.** |
| Cost | ~21.9k input tokens (mostly search results) plus 376 output: about **$0.11** including the search. Matches the design's ~$0.10 brainstorm estimate. |

**Lesson:** the AI is good at gift *concepts*, but its links aren't reliably buyable. Keep the design's split: the AI brainstorms, then the **resolve** step uses Zinc's product search and offers to find the exact item, live price and URL (§6.3). The prompt tests will confirm whether brainstorming should return product names plus search terms instead of URLs.

## Fixtures

Made up for the spike (the owner asked for invented data). They're in `spikes/ai/fixtures/` and move to `apps/web/lib/ai/fixtures/` once the scaffold exists.
- `people.json`: 5 people with hand-entered facts, a budget, an occasion and a ship-to state. They cover an easy case (Maya), a "has everything" case (Dad, Sam), an older person with constraints (June), and a minimalist (Priya).
- `captures.json`: 10 captures as page text, the way the extension sends it (Instagram, Pinterest, a Facebook post, an Amazon wishlist, an article, a family text). Four are **sensitive-trait traps**: arthritis and blood pressure medication, religion, pregnancy, and grief.

Script: `spikes/ai/run.mjs` (`node spikes/ai/run.mjs extract|ideas`). Outputs with tokens, cost and timing are in `spikes/ai/out/`.

## Extraction (prompt v1, Opus 5.5, effort low)

| | Result |
|---|---|
| Cost and speed | $0.006–0.015 per capture (**~1¢**, design estimate 2¢), 3–7 s |
| Quality | Strong. It separates **wants** from **owns**: "needs a new rotary fly-tying vise" plus "owns old vise, worn out"; "wants Portra 400 (ran out)" plus "owns Canon AE-1". Confidence is sensible (Pinterest saves 0.4–0.5, direct statements 0.9). |
| Sensitive traps (C-8) | **4 of 4 passed.** Arthritis and medication became only "prefers easy-open, large-grip items" and "avoid small latches". Religion (Diwali at temple), pregnancy and grief were not recorded at all. |
| Misses | A joke recorded as a want ("more sleep", 0.5), and a guess ("new parent, may like baby gear"). Both are low confidence, and the user confirms every fact (C-3). |

Keep the code-side sensitive-category post-filter from the design anyway (defense in depth). The prompt alone held up here, but on only 4 traps.

## Gift ideas (brainstorm with 3 web searches, then rank)

| Version | Change | What happened |
|---|---|---|
| v1 | Hand-entered facts only | Specific, real products with sensible reasons, and June's constraints were respected. **But Dad's ideas never mentioned his broken vise** (not in his hand-entered facts) and wandered into saltwater fishing. Some items were hard to buy: personalized golf balls, a small publisher's site. |
| v2 | Rules: stock items only, prefer Amazon, Walmart, Target and Best Buy, weigh captured wants and owns, stay within stated interests | Fewer hard-to-buy items. **A bug in the spike script meant captured facts still weren't included**, so this run says nothing about captures. |
| v3 | Rules: stated wants first (use the over-budget slot if needed), worn-out owned items are replacement needs, check every idea against "owns", ship-to isn't where hobbies happen. **Captured facts included** (confidence ≥ 0.6, as if confirmed) | **Dad: #1 rotary vise for size 18 hooks (9.5), #2 magnifying lamp for tiny flies.** Priya: Onyx beans like the ones she buys, no kettle (she owns one). Big step up. |

Example reason (v3, Dad): *"His 20-year-old vise is worn out, and this rotary replacement grips the size 18 and smaller hooks he ties his Adams on. Buy the vise alone, not the kit."*

| Call | Cost | Time |
|---|---|---|
| Brainstorm (8 ideas, 3 searches) | $0.24–0.46 (design estimate $0.10) | 35–56 s |
| Rank and reasons | $0.02–0.035 (design estimate $0.03) | a few seconds |

Search results make up most of the brainstorm cost. Ways to lower it: allow 2 searches, use Sonnet 5.5 (half the price), or the gateway's Perplexity search tool. **Prices from the AI are often "not confirmed"**, and one idea (the vise) came back with no price at all. That's fine, because resolving through Zinc fills it in.

## Findings for the design

1. **Model ID:** `anthropic/claude-opus-5.5` (§2.1, §7 say `claude-opus-5-5`).
2. **Brainstorm output** should be `{title, product_search, retailer_hint, est_price, fits_facts[], why}` with **no URLs**. Resolve (§6.3) turns `product_search` into a live Zinc offer.
3. **The idea prompt needs the v3 rules:** stated wants first, worn-out owned items count as needs, an explicit check against owned items, and ship-to isn't where hobbies happen.
4. **Captured facts must reach idea generation.** This is obvious from the design (§3.1), but the spike showed how much quality depends on it.
5. **Cost (§7, §10):** brainstorm about $0.30, extraction about $0.01, rank about $0.03. Update the estimates.

## Still to do (moved to ALL-42)

- [ ] **Screenshots (vision):** the fixtures are text only. Test extraction from a real screenshot, which is what the extension sends (§6.2).
- [ ] **Cheaper model:** run v3 on Sonnet 5.5 and compare quality and cost (`node spikes/ai/run.mjs ideas anthropic/claude-sonnet-5.5`).
- [ ] **Resolve through Zinc:** feed `product_search` into Zinc's search on the app account (T17). Needs a funded app Zinc account or a sandbox key. Sandbox search returns sample data only.
- [x] Update design §7 with real costs and the corrected model ID
- [ ] Rotate the gateway key (it was pasted into a Claude session)
