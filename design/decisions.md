# Technical Design Decisions Log

Running record of technical design decisions. Product decisions are in `../planning/decisions.md`.

## 2026-10-17

| # | Decision | Source |
|---|---|---|
| T1 | Core platforms: **Supabase** and **Vercel**. | Owner |
| T2 | Builders: the owner and Jim, both working with Claude. More people may join later if the product succeeds. | Owner |
| T3 | **TypeScript everywhere** (web app, backend, Chrome extension). | Owner, on Claude's recommendation |
| T4 | **Running budget: up to about $100 a month** for the MVP (hosting, AI, email, checkout fees; gift purchases excluded). Claude Max plans cover development. App runtime AI calls are billed through Vercel AI Gateway (see T11). | Owner |
| T5 | After approval, the design is split into Linear tickets in a Linear project, labeled in **waves of parallel work**. Each wave unblocks the next. | Owner |
| T6 | A Zinc account and wallet per user is **acceptable for the MVP**. Funding should be automated where Zinc allows it (auto-recharge or an API top-up). Otherwise the app prompts for a top-up before the order and holds the order rather than failing. The checkout spike (W1-2) confirms which. | Owner |
| T7 | All services run under the owner's **allensforever711@gmail.com** account, which is already set up across them, and the code is in the free **gifts-af** GitHub organization, with allensforever711, aarontallen, JimtheBurger and brb3 as owners. The repo was first created under aarontallen by mistake, and on 2026-10-18 it moved to allensforever711 and then to gifts-af so all builders have full control. Jim is added to each service. | Owner |

## 2026-10-18

| # | Decision | Source |
|---|---|---|
| T8 | **Supabase is the data and timing layer, and Vercel runs all the code.** Supabase `pg_cron` calls the app's round engine on a schedule (see T9), replacing Vercel Workflow and Vercel Cron. The work stays in the Next.js app rather than Supabase Edge Functions, so there's one runtime and one deploy. The owner handles Supabase's inactivity pause by upgrading or scheduling a keep-alive if needed. | Owner, refining Claude's proposal |
| T9 | The round engine runs **once a day at 8 a.m. Eastern** (12:00 UTC), not every 15 minutes. Every step in a round is measured in days, user actions and webhooks act right away, and a morning run means messages always arrive at a sensible hour. Failed steps retry the next day. | Owner |
| T10 | **Lean repo layout.** pnpm workspaces without Turborepo. One shared package (`packages/core`) for business rules and shared types. Migrations live in `supabase/`, where the Supabase CLI expects them, and AI code lives in `apps/web/lib/ai`. Tools or packages are added only when there's a real need. | Owner, on Claude's recommendation |
| T11 | **The AI backend is replaceable.** Calls go through the AI SDK and Vercel AI Gateway, with usage billed through Vercel and no separate AI provider account. The model for each task is set in one config file. The design talks about "the AI model" rather than a vendor, and Claude Opus 5.5 is today's default. Switching to a cheaper model or another provider such as OpenAI should be a config change, and web search sits behind a replaceable step. | Owner |
