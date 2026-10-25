# ALL-19 (part 2b): Move the list app into a `lists` schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the list app's tables and functions live in their own `lists` schema (T19, T20), the app keeps working, and display names come from `public.profiles`. Rehearsed on `dev` with test data, then run on `prod`.

**Architecture:** one migration moves `lists`, `list_items` and `gift_claims` with `alter table … set schema lists`, which keeps the rows, privacy rules, indexes and grants. It also recreates the five functions in `lists`, because their bodies name `public.*` explicitly. The app's Supabase calls add `.schema("lists")`. pgTAP tests cover the list app's privacy and sharing rules for the first time.

**Spec:** ALL-19 ticket (the GiftsAF tables bullet); design §2.2; T19, T20, T26. The choices agreed in chat on 2026-10-25: display names come from `profiles`; a brief prod outage between the deploy and the migration push is acceptable; the rehearsal uses test data made in the app, with no copy of real users.

## Global constraints

- **No data changes.** Rows aren't copied or rewritten, only moved to the new schema.
- **Same behaviour.** Function signatures, return shapes and error codes stay exactly as they are (`42501` owner claiming, `P0002` not found, `already_claimed`), and so do their grants: `get_shared_list` and `claim_gift` stay open to anon, and `save_list`, `unclaim_gift` and `viewer_display_name` stay signed-in only.
- **Display name:** `profiles.display_name`, falling back to `profiles.email`, then the account email. Still capped at 80 characters.
- **`lists` schema:** `usage` for anon (share links work signed out), authenticated and service_role. It's exposed in `config.toml` and, on hosted projects, under Data API > Exposed schemas.
- Before calling it done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:test`.

## Review focus

1. **A share link opened while signed out** still shows the list and lets a guest claim.
2. **An owner opening their own share link** still sees "this is your list" and can't claim.
3. **Saving a list keeps its claims**, because item ids stay stable (the gift_claims migration's fix).
4. **Nothing is left behind in `public`:** no list tables, and no old functions the app could still call.
5. **The keep-alive route** still reaches the database.

---

### Task 1: Database tests for the list app, then the migration

**Files:** create `supabase/tests/lists.test.sql` and `supabase/migrations/20261025140000_lists_schema.sql`; modify `supabase/config.toml` (expose `lists`).

- [ ] Write `lists.test.sql`:
  - the tables exist in `lists` and not in `public`
  - A saves a list with two gifts through `lists.save_list` and reads it back
  - B sees none of A's lists or items
  - anon sees no rows in the tables
  - anon's `lists.get_shared_list(token)` returns the title and 2 items
  - a guest claims one gift by name
  - a second claim on the same gift returns `already_claimed`
  - the owner claiming gets `42501`
  - B, signed in with display name "Bee", claims and is named "Bee"
  - a signed-in user without a display name is named by their email
  - B unclaims their own claim
  - re-saving the list keeps the guest's claim
  - the `public` versions of the five functions no longer exist
- [ ] Run `pnpm db:test`. It fails.
- [ ] Write the migration and update `config.toml`.
- [ ] Run `pnpm supabase db reset && pnpm db:test`. It passes.
- [ ] Commit: `feat(db): move the list app into a lists schema (ALL-19)`.

### Task 2: App code

**Files:** `apps/web/modules/lists/lib/lists.ts`, `apps/web/modules/lists/actions/lists.ts`, `apps/web/modules/lists/actions/claims.ts`, `apps/web/app/api/keepalive/route.ts`, plus any tests that mock these calls.

- [ ] Every `.from("lists" | "list_items")` and `.rpc(...)` for list functions goes through `.schema("lists")`.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Everything passes.
- [ ] Run the app against local Supabase: sign up, add two gifts, open the share link in a private window, claim as a guest. It works.
- [ ] Commit: `feat(lists): read and write through the lists schema (ALL-19)`.

### Task 3: Docs, review, PR

- [ ] `design/technical-design.md` §2.2: the list tables are in `lists`. README: Data API exposed schemas now `concierge` and `lists`. Regenerate types with `lists` added to `db:types`.
- [ ] Fresh review, then the PR `feat(db): move the list app into a lists schema (ALL-19)`, marked `Closes ALL-19` if the rollout is done, otherwise `Part of`.

### Task 4: Rollout (with the owner)

- [ ] The owner runs `! pnpm supabase login` as allensforever711.
> **Order matters:** expose a schema in Data API settings only **after** the migration that creates it is pushed. Exposing a schema that doesn't exist yet makes the whole Data API return 503 (tested locally on 2026-10-25).

- [ ] **`dev`:** make test lists in the current `main` preview (sign up, add gifts, share, claim). Then `supabase link --project-ref bcemtqvdbrrgiipzggyw`, check `migration list`, `db push`, and right away expose `concierge` and `lists`. Open this PR's preview and check that the test lists, share links and claims survived.
- [ ] **`prod`:** with the owner's go, at a quiet time: merge the PR and wait for Vercel's production deploy to be Ready. Then link `pegtrucfuaaufqvsavpb`, check `migration list`, `db push`, and right away expose `concierge` and `lists`. The list app is down from the deploy until the exposure, about a minute. Check that the 3 users' lists still load and the share links work.
