# ALL-182 Share your birthday from Settings: Spec and Plan

> **Status:** design approved by Jim, 2026-11-25 (option A, build option 1), with the scope-freeze exception. Built locally and shown to Jim before any PR.

**Goal:** someone who shares a list can save their birthday once, and people who add them from that list don't need to know it.

**Links:** [ALL-182](https://linear.app/allens-forever/issue/ALL-182), T42, T78, T92, D45, decision 55.

## Spec: what it does

### Who it's for and what they can do

1. **Save it:** as someone with a list, I can save my birthday in Settings, so people who add me have it.
2. **Get it:** as someone adding a person from their list, I find their birthday filled in.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, with a list (or their list failed to load) | they open Settings | a "Birthday" row under You reads "Mar 14", "Not added" or "Couldn't load", with or without the concierge. With no list and nothing saved, no row. Sign-up never asks |
| AC-2 | the Birthday screen | they pick month and day and Save | it's saved, "Saved" shows, and the row shows it. Half a date, or one that doesn't exist (Feb 30), is refused in plain words; Feb 29 is allowed |
| AC-3 | the Birthday screen | it opens | it says "Optional. Anyone signed in with your list link can see this when they add you. People who already added it keep it." There is no year |
| AC-4 | a saved birthday | they tap Remove | it's deleted at once |
| AC-5 | signed in, on the Add form from someone's current link, who saved a birthday | it opens | month and day are filled in, with "From their list. You can change it.", which goes once they edit it. The year is empty. They can change or clear it, and what's on the form is what's saved |
| AC-6 | no birthday, a dead link, their own list, or the read failed | the Add form opens | as today: empty, and the form still works |
| AC-7 | the saved birthday changes or is removed | later | people already added keep theirs. People added before are never filled in |
| AC-8 | anyone | reads or writes the table | only their own row. Anon gets nothing. The read function is for signed-in users, returns month and day only, and only for the list's current token |
| AC-9 | the list page, its preview, `get_shared_list` | anyone opens them | they carry no birthday |
| AC-10 | `list_birthday_enabled` isn't exactly 1, or `list_link_card_enabled` isn't | the Add form or Settings opens | the database function returns nothing, so nothing is filled in. Settings hides the row unless one is saved; its screen then offers only Remove, and saving is refused. A failed or missing setting counts as off and never breaks the page |
| AC-11 | save or remove | it runs | one event, user id only, never the date; failures add an error code |
| AC-13 | no birthday saved, the feature on | they tap Share on My list | the link copies as today, and on the Saved row, moving nothing, a small note says "No birthday saved. Add it (optional)" (phones: without "(optional)", and Saved is hidden meanwhile), linking to the Birthday screen. Not shown before Share, with one saved, when the read failed, to guests, or while a save has failed. It never delays or blocks the copy |
| AC-12 | the account is deleted | | the row goes with it |

### Out of scope

A year; a separate sharing switch; filling in people already added; telling the owner who saw it; prompting for it at sign-up or in tips.

### Open questions

None.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Is there a sharing switch? | No, saving shares it, and the screen says so | Jim |
| Year? | No | Jim; identity data, and reminders don't need it (T42) |
| Where is it asked? | Entered in Settings; mentioned once, in small text, after Share | Jim: sign-up stays quick |
| Where is it stored? | `public.account_birthdays`, one row per account | Jim; like `account_addresses` |
| Who can read it? | A signed-in holder of the current token, through `lists.owner_birthday` | Jim |
| Setting ships on? | Yes, 1 | **[Claude's call]** nothing is shared until someone saves one |
| Does a filled-in birthday start reminders for someone with the concierge? | Yes, as a typed one does | **[Claude's call]** it is on the form, editable, before they save |

## Principles check

- **Simplest version?** One table, one function, one screen. The Add form's fields are reused.
- **Hard-coded values?** `list_birthday_enabled`.
- **Product boundaries?** Account data in `public`; the function that reads a list token is in `lists`.
- **New personal data?** Month and day of birth, optional, for filling the Add form now. Deleted on Remove or with the account. No vendor gets it.
- **Revises:** T42 (1) (asks people for their own birthday, optionally), T78 and decision 55 (the Add form starts with more than a name).
- **E9:** `account_birthday.saved` and `.removed` events; live check with the QA account, its birthday removed after. Off: `list_birthday_enabled` = 0.
- **Docs:** next T#, a product decision, the screens page, technical design, `ui.md`, `operations.md`, the privacy page, database map.

## Plan

**Architecture:** migration first, in its own PR; then `lib/account-birthday.ts`, `/settings/birthday`, and the Add form's starting values. Saving is one Save button, since month and day are only valid together (as My address).

### Task 1: Database (AC-8, 9, 10, 12)

- [ ] pgTAP `account_birthdays.test.sql` first; add the key to `app_settings.test.sql`.
- [ ] `account_birthdays(user_id pk, month, day, created_at, updated_at)`; check `make_date(2000, month, day)` is real, written as a plain check on days per month; RLS as `account_addresses`; `lists.owner_birthday(p_token uuid) returns jsonb`.
- [ ] `pnpm db:types`, `pnpm db:map`.

### Task 2: Settings (AC-1 to 4, 10, 11)

- [ ] Unit tests for parse, read, save, remove; component tests for the row and the screen.

### Task 3: Add form (AC-5, 6)

- [ ] Component tests for the Share line (AC-13), the page and form; a failed read logs and leaves the form as today.

### Task 4: Journey and docs

- [ ] One browser journey: save in Settings, another account adds from the link, birthday saved on the person; then Remove, and a third account sees nothing. Layout check for the screen.
- [ ] Docs.

## Review focus

- A signed-out or old-token reader gets a birthday (pgTAP).
- A birthday leaks into the list page (pgTAP on `get_shared_list`).
- A failed read blocks adding someone (component test).
