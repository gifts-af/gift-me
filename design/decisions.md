# Technical Design Decisions Log

Running record of technical design decisions. Product decisions are in `../planning/decisions.md`.

## 2026-10-17

| # | Decision | Source |
|---|---|---|
| T1 | Core platforms: **Supabase** and **Vercel**. | Owner |
| T2 | Builders: the owner and Jim, both working with Claude. More people may join later if the product succeeds. | Owner |
| T3 | **TypeScript everywhere** (web app, backend, Chrome extension). | Owner, on Claude's recommendation |
| T4 | **Running budget: up to about $100 a month** for the MVP (hosting, AI, email, checkout fees; gift purchases excluded). Claude Max plans cover development. App runtime AI calls use a separate pay-as-you-go Claude API account. | Owner |
| T5 | After approval, the design is split into Linear tickets in a Linear project, labeled in **waves of parallel work**. Each wave unblocks the next. | Owner |
| T6 | A Zinc account and wallet per user is **acceptable for the MVP**. Funding should be automated where Zinc allows it (auto-recharge or an API top-up). Otherwise the app prompts for a top-up before the order and holds the order rather than failing. The checkout spike (W1-2) confirms which. | Owner |
| T7 | All services run under the owner's **allensforever711@gmail.com** account, which is already set up across them, and the code is in the **aarontallen** GitHub account. Jim is added to each one. | Owner |
