# ALL-183 Share your sizes and favorite color: Spec and Plan

> **Status:** spec written 2026-11-26 from the owner's answers, with the owner's scope-freeze exception. It still needs an adversarial review, then the plan. Building starts after the owner's family test.

**Goal:** someone with a list saves their sizes once, and a person claiming a gift from that list sees the sizes that fit that gift, so they buy the right option.

**Links:** [ALL-183](https://linear.app/allens-forever/issue/ALL-183). Pattern: [ALL-182](ALL-182-share-birthday.md) (T97). Related: T42, D31, `design/ui.md` principle 7.

## Spec: what it does

### Who it's for and what they can do

1. **Save and share:** as someone with a list, I can save my sizes and favorite color in Settings and choose which ones to share, so people buying for me pick the right size.
2. **See when claiming:** as someone claiming a gift from a list, signed in or not, I see the owner's shared sizes that fit that gift, before I commit.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, with a list (or their list failed to load) | they open Settings | a "Sizes and favorites" row under You reads "4 shared", "2 saved, none shared", "Not added" or "Couldn't load". With no list and nothing saved, there's no row. Sign-up never asks |
| AC-2 | the Sizes and favorites screen | it opens | seven optional boxes in this order: Shirt or top, Pants, Dress, Shoe, Ring, Hat, Favorite color, each with a Share switch. It says "Optional. Shared ones are shown to anyone with your list link when they go to claim a gift." |
| AC-3 | the screen | they fill boxes, flip switches and tap Save | all of it is saved in one go and "Saved" shows. Text is trimmed, at most 30 characters, plain text only. A Share switch on an empty box is refused in plain words ("Add a size to share it"). An emptied box deletes that item |
| AC-4 | a saved item | they turn Share off and Save | from then on nobody else can read it |
| AC-5 | a claim box opens on someone else's list, from its current link, with at least one shared item | it opens | under the gift name, a "<First name>'s sizes" panel lists the shared items that fit the gift (AC-6) as "Label value", joined by " · ". The panel loads without delaying the box or the claim |
| AC-6 | the gift's name | the panel picks items | a whole-word, case-insensitive match picks the size types the name is about (shoe: shoe, sneaker, boot, slipper, sandal, loafer, heel; top: shirt, tee, t-shirt, sweater, sweatshirt, hoodie, jacket, coat, fleece, vest, blouse, polo, top, pullover, cardigan; pants: pants, jeans, trousers, shorts, leggings, joggers, chinos; dress: dress, gown; ring: ring; hat: hat, cap, beanie, beret). Favorite color always shows when it's shared. When nothing matches, every shared item shows |
| AC-7 | nothing shared, the feature off, the read failed, or the list is the viewer's own | a claim box opens | no panel, and claiming works as today. A failed read is logged |
| AC-8 | anyone | reads or writes the table | only their own rows. Anon gets nothing from the table. The read function takes a list token and returns only shared items, only for that list's current token. It works signed out, and never for the list's owner |
| AC-9 | the list page, its preview and `get_shared_list` | anyone opens them | no sizes. They're read only when a claim box opens |
| AC-10 | `list_sizes_enabled` isn't exactly 1 | the claim box or Settings opens | the function returns nothing. Settings hides the row unless something is saved; its screen then offers only Remove all, and saving is refused. A failed or missing setting counts as off |
| AC-11 | save, remove all, or a failed read | it happens | one event with the user id only, never a size or label. Failures add an error code |
| AC-12 | the account is deleted | | its rows go with it |

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
| Where? | In the claim box, before Claim gift | Owner. Not on the list page or in previews (AC-9) |
| Which items show? | Keywords in the gift's name; favorite color always; all shared when nothing matches | Owner asked for "smart, else all". **[Claude's call]** keywords over AI: free, instant, the same every time, and a wrong guess only adds a line. The words are product logic, kept in code next to their tests, like the guided questions' categories |
| Address? | Left as it is | Owner |
| Free text or picklists? | Free text, 30 characters | **[Claude's call]** sizes vary too much ("34 x 32", "10.5 wide", "M or L") |
| Stored where? | `public.account_sizes`, one row per item: `(user_id, kind, value, shared)` | **[Claude's call]** like `account_birthdays`; a row per item makes one switch per item simple |
| Setting ships on? | Yes, 1 | **[Claude's call]** nothing shows until someone saves and shares something |

## Principles check

- **Simplest version?** One table, one read function, one Settings screen, one panel in the existing claim box. No AI, no picklists, no new email.
- **Hard-coded values?** `list_sizes_enabled` (setting). The 30-character limit is a column check, like other text limits. The keywords are product logic, not tunables.
- **Product boundaries?** Account data in `public`; the token read is `lists.owner_sizes` in the lists schema, called from the lists module only.
- **New personal data?** Up to seven short size or color values the person chose to enter, for the claim box now. Off by default, deleted on remove or with the account, never sent to a vendor, never logged. **Exposure, said plainly:** a shared item can be read by anyone holding the list link, because signed-out people can claim. The screen says so (AC-2).
- **Revises:** T42 (1) (asks people for their own sizes, optionally), T97's pattern (signed-out readers here, where the birthday needs sign-in).
- **E9:** `account_sizes.saved`, `.removed` and `lists.owner_sizes_failed` events. Live check with the QA account (share one size, open a claim box signed out, then remove it). Off: `list_sizes_enabled` = 0.
- **Docs:** next T# and product decision, `ui.md` (screen and panel), `technical-design.md`, `operations.md` (setting), the privacy page, the database map, the screens page, and CLAUDE.md's exception line.

## Plan

Written after the adversarial review.
