# ALL-183 Share your sizes and favorite color: Spec and Plan

> **Status:** spec written 2026-11-26 from the owner's answers, with the owner's scope-freeze exception. It still needs an adversarial review, then the plan. Building starts after the owner's family test.

**Goal:** someone with a list saves their sizes once, and a person claiming a gift from that list sees the sizes that fit that gift, so they buy the right option.

**Links:** [ALL-183](https://linear.app/allens-forever/issue/ALL-183). Pattern: [ALL-182](ALL-182-share-birthday.md) (T97). Related: T42, D31, `design/ui.md` principle 7.

## Spec: what it does

### Who it's for and what they can do

1. **Save and share:** as someone with a list, I can save my sizes and favorite color in Settings and choose which ones to share, so people buying for me pick the right size.
2. **See before buying:** as someone looking at a gift on a list, signed in or not, I see the owner's shared sizes that fit that gift, in "Going to buy it?" and in the claim box, before I buy or commit.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, with a list (or their list failed to load) | they open Settings | a "Sizes and favorites" row under You reads "Not added", "3 saved, none shared", "3 saved, 1 shared", "3 shared" (everything saved is shared) or "Couldn't load". With no list and nothing saved, there's no row. Sign-up never asks |
| AC-2 | the Sizes and favorites screen | it opens | seven optional boxes in this order: Shirt or top, Pants, Dress, Shoe, Ring, Hat, Favorite color, each with a Share switch. It says "Optional. Shared ones are shown to anyone with your list link when they go to claim a gift." |
| AC-3 | the screen | they fill boxes, flip switches and tap Save | all of it is saved in one upsert and "Saved" shows. Text is trimmed; a value is at most 30 characters, counted the same way by the form and the database, with no line breaks or control characters, refused in plain words. A Share switch is disabled while its box is empty, and emptying a box clears its value and its Share |
| AC-4 | a saved item | they turn Share off and Save | from then on nobody else can read it |
| AC-5 | "Going to buy it?" or the claim box opens on someone else's list, from its current link, with at least one shared item | it opens | under the gift name, a "<Name>'s sizes" panel lists the shared items that fit the gift (AC-6) as "Label: value", joined by " · ". The name is the one the list heading uses, else "Their sizes". The panel's space is reserved so nothing moves when it arrives, and it never delays the box, the store link or the claim |
| AC-6 | the gift's name | the panel picks items | a whole-word, case-insensitive match, singular or plural (s/es), picks the size types the name is about (shoe: shoe, sneaker, boot, slipper, sandal, loafer, heel, cleat; top: shirt, tshirt, tee, sweater, sweatshirt, hoodie, jacket, coat, fleece, vest, blouse, polo, top, pullover, cardigan, pajama, onesie; pants: pants, jeans, trousers, shorts, leggings, joggers, chinos, sweatpants, skirt; dress: dress, gown; ring: ring; hat: hat, cap, beanie, beret). "Dress" right before a shirt, shoe or pants word counts as that word, not a dress. Favorite color always shows when it's shared. When nothing matches, every shared item shows. A wrong hit only adds a line (a "Ring Light" shows ring size). A table of at least 30 real store names pins the behavior in a test |
| AC-7 | nothing shared, the feature off, the read failed, or the list is the viewer's own | either box opens | no panel, and both work as today. A failed read is logged |
| AC-8 | anyone | reads or writes the table | only their own row; anon gets nothing from the table. `lists.owner_sizes(p_token)` is granted to anon and authenticated. It returns only shared items, only for the list's current token, and nothing to the list's owner (`owner_id is distinct from auth.uid()`, so signed-out callers do get them). pgTAP calls it as anon, as a signed-in stranger and as the owner |
| AC-9 | the list page, its preview and `get_shared_list` | anyone opens them | no sizes in the page or its data; the app reads them only when one of the boxes opens. **The real boundary:** anyone holding the current token can read every shared item, because the function is public, as the Settings copy says. Resetting the link cuts them off |
| AC-10 | `list_sizes_enabled` or `list_link_card_enabled` isn't exactly 1 | a box or Settings opens | the function returns nothing. Settings hides the row unless something is saved; its screen then offers only Remove all, and saving is refused. A failed or missing setting counts as off |
| AC-11 | save, remove all, or a failed read | it happens | one event: the user id on save and remove; on a failed read the viewer's user id if signed in and otherwise none. Never the token, a size or a label. Failures add an error code |
| AC-12 | the account is deleted, or the erase runbook runs | | its row goes. The runbook's step 1 deletes it straight away, without waiting for gifts in flight, and the runbook test covers it |

### Out of scope

The address (stays as it is). Sizes for people you buy for (the concierge's profile already has those). Free-form extra fields. Using AI to pick sizes. Telling the owner who saw them. Asking for sizes at sign-up or in tips.

### Open questions

None.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Which fields? | Shirt or top, pants, dress, shoe, ring, hat, favorite color; a fixed list | Owner: settings that help buy the right option. Adding one later is a small change. **[Claude's call]** the exact list, which the owner saw in the mock-up |
| Sharing? | A switch per item, off by default | Owner |
| Who sees shared items? | Anyone claiming from the list, signed in or not | Owner: family often claim without signing in |
| Where? | In "Going to buy it?" and the claim box | Owner asked for claiming; the review showed people often buy before they claim. **[Owner to confirm]** |
| Which items show? | Keywords in the gift's name; favorite color always; all shared when nothing matches | Owner asked for "smart, else all". **[Claude's call]** keywords over AI: free, instant, the same every time, and a wrong guess only adds a line. The words are product logic, kept in code next to their tests, like the guided questions' categories |
| Address? | Left as it is | Owner |
| Free text or picklists? | Free text, 30 characters | **[Claude's call]** sizes vary too much ("34 x 32", "10.5 wide", "M or L") |
| Stored where? | `public.account_sizes`, one row per account: seven nullable text columns, and a Share boolean for each | **[Claude's call]** like `account_birthdays`; one row makes a save one upsert, so it can't half-succeed |
| Setting ships on? | Yes, 1 | **[Claude's call]** nothing shows until someone saves and shares something |

## Principles check

- **Simplest version?** One table, one read function, one Settings screen, one panel in the existing claim box. No AI, no picklists, no new email.
- **Hard-coded values?** `list_sizes_enabled` (setting). The 30-character limit is a column check, like other text limits. The keywords are product logic, not tunables.
- **Product boundaries?** Account data in `public`; the token read is `lists.owner_sizes` in the lists schema, called from the lists module only.
- **New personal data?** Up to seven short size or color values the person chose to enter, for the claim box now. Off by default, deleted on remove or with the account, never sent to a vendor, never logged. **Exposure, said plainly:** a shared item can be read by anyone holding the list link, because signed-out people can claim. The screen says so (AC-2).
- **Revises:** T42 (1) (asks people for their own sizes, optionally), T97's pattern (signed-out readers here, where the birthday needs sign-in).
- **E9:** `account_sizes.saved`, `.removed` and `lists.owner_sizes_failed` events. Live check with the QA account (share one size, open a claim box signed out, then remove it). Off: `list_sizes_enabled` = 0.
- **Docs:** next T# and product decision, `operations.md` > Erasing data step 1 and its runbook test, `ui.md` (screen and panel), `technical-design.md`, `operations.md` (setting), the privacy page, the database map, the screens page, and CLAUDE.md's exception line.

## Plan

Written after the adversarial review.
