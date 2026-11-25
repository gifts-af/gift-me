# Security review (ALL-37)

Read from the source at `8e41a6a` on 2026-11-25, by a reviewer who hadn't seen the build. No live database, Vercel settings or fresh client bundle was inspected, and no tests were run for the review itself.

| Item | Result | Notes |
|---|---|---|
| Deleting a person removes rows and screenshots | **Accepted gap** (owner, 2026-11-25) | A user's delete hides the person (T27; the privacy page says so). The admin hard delete removes rows only; the files are deleted by hand, as part of the same steps (`design/operations.md` > Erasing data). Deleting a capture's own text and screenshot, which D51 left to this review, isn't built; it's parked. |
| Sensitive-trait filter (C-8) | **Passed after a fix** | "None of these" saved its typed reason unchecked. It's now refused like any other typed fact, with a database test that failed first. Fixtures cover the filter. A word list can't catch everything. Raw captures and emailed notes are stored and sent to the AI as they are, by design (technical design §8). |
| RLS on every table | **Passed** | Except `admin.deletion_log`, which no user role can reach. Every `SECURITY DEFINER` function sets `search_path`; the user-callable ones check ownership or a share token, apart from `setting_int` (below). |
| Service role only in the round engine and webhooks | **Passed, with more callers** | Some pages and actions use it too. Each takes the user from a verified session or token first. |
| Tick, job and health reject calls without their secret | **Passed** | An unset or empty secret is refused too. |
| Webhook signatures (Zinc, Resend) | **Passed** | Zinc has no replay window; order status only moves forward. |
| Secrets: environment, Vault, logs, client bundles | **Passed on the source** | Vercel's live settings and a fresh bundle weren't inspected. CI's bundle check covers Zinc keys and Vault names. |
| Extension permissions | **Passed** | `activeTab`, `scripting` and `storage`, with no host permissions. |
| Signed-in users read only the settings meant for them | **Accepted gap** (owner, 2026-11-25) | Any signed-in user can read every whole-number setting. No secrets or personal data were found there. Never put a secret in `app_settings`. |

**Not covered:** Turnstile and the public forms, Google import, fetching store pages, rate limits, dependency vulnerabilities, and order placing beyond its signatures and scoping.

Smaller findings are in `planning/ideas.md` > Parked during the scope freeze.
