# The GiftsAF fee: proposed amount

**Status:** proposed, 2026-11-25. Waiting for Aaron and Jim ([ALL-76](https://linear.app/allens-forever/issue/ALL-76)).

**Proposal: keep the fixed part at $2.00, plus the actual card fee** (2.9% + 30¢ of the whole charge). It's a setting, so it can change without a deploy.

## The parts

| Part | Amount | Based on |
|---|---|---|
| Ordering | $1.00 | Zinc's fee per order |
| AI suggestions | $0.65 | About 2 idea runs per gift bought, at 32¢ each |
| Running the service | $0.35 | What's left. See below |
| **Fixed part** | **$2.00** | |

## What the numbers say

Production, 2026-11-24 10:23 AM to 2026-11-25 afternoon ET, from cost tracking (ALL-144):

- **An idea run costs about 32¢** (6 runs that used AI: 17¢ AI, 15¢ lookups). Our estimate was 40¢.
- One more run needed no AI and cost 9¢. Two failed and cost nothing.
- **3 of the 6 runs found nothing.** Each still costs about 32¢.
- **A capture costs about 0.3¢** (2 recorded). Too small to show.
- AI costs are actual. Lookups are counted at 1¢ each, because Zinc reports no price.
- **No gift has been bought since tracking began, so there's no real cost per gift.** 2 runs per gift is a guess.

| Idea runs per gift bought | Ordering + AI | Left from $2.00 |
|---|---|---|
| 1 | $1.32 | $0.68 |
| 2 (used here) | $1.64 | $0.36 |
| 3 | $1.96 | $0.04 |
| 4 | $2.28 | −$0.28 |

So $2.00 covers up to 3 runs per gift. The 1¢ between $0.64 and $0.65 above is rounding.

## Running the service

| | Per month | Gifts a month for 35¢ each to cover it |
|---|---|---|
| Today: the domain | $1.00 | 3 |
| Once we take money: Vercel Pro $20, GitHub Team about $16, domain $1 | about $37 | 106 |
| If Supabase Pro ($25) is needed too | about $62 | 178 |

The second and third rows come from T24, ALL-75 and the technical design; prices weren't rechecked. Nothing is chosen yet.

**[Claude's call]** We absorb the rest at launch. Dividing $37 by 10 gifts would add $3.70 to each, and free lists use the service too.

## What the buyer sees

```
GiftsAF fee                       $3.05
Launch pricing: at cost

Ordering          placing it with the store     $1.00
AI suggestions    finding ideas, including      $0.65
                  ones nobody picked
Running GiftsAF   website and email             $0.35
Card fee          what the card company charges $1.05
```

Example: a $22.59 gift, charged $25.64.

## Not covered by the fee

- The card fee we lose when a store cancels (ALL-98).
- Amazon links pasted on free lists, 1¢ each (decision 57).
- Tax on the fee: a question for an accountant (ALL-98).

## When to look again

After 20 bought gifts, or a month after friends join, whichever is first **[Claude's call]**. Change it if the average number of runs per gift is above 3.
