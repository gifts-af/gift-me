# Spike: AI capture extraction and gift ideas (W1-3, ALL-17)

Date started: 2026-10-25. Status: **setup done, prompt tests next** (waiting on real captures and people sketches).

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

## Still to do

- [ ] About 10 real captures: extraction prompt v1, facts by category with confidence, sensitive-trait filter (C-8)
- [ ] About 5 people sketches: brainstorm, resolve (Zinc search on the app account, T17), then rank with reasons
- [ ] Measured cost per call type, compared with design §7
- [ ] Optional: the same fixtures on a cheaper model (Sonnet 5.5 at half the price, Haiku 5.5 at about 1/40)
- [ ] Commit fixtures to `apps/web/lib/ai/fixtures/` (or `spikes/ai/fixtures/` until the scaffold exists)
- [ ] Update design §7 with real costs and the corrected model ID
- [ ] Rotate the gateway key
