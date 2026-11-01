# Spike: email sending and inbound (W1-4, ALL-18)

Date: 2026-11-01. Status: **done.** Both directions work on the real domain, `giftsaf.com`.

## Recommendation

**Use Resend, on `giftsaf.com`.** It's the only one of the two with inbound email on a free plan, and every check passed on the first try.

1. **Send from `hello@giftsaf.com`.** The test landed in Gmail's **Primary inbox**, with SPF, DKIM and DMARC all passing.
2. **Receive on its own subdomain, `in.giftsaf.com`.** This leaves the main domain's mail settings free (for example, a real mailbox for `@giftsaf.com` later).
3. **Each user gets a private capture address: `notes+{token}@in.giftsaf.com` [Claude's call].** The token is random and unguessable, and it identifies the user, so the note is filed correctly whatever account they send from. Users can reset it in Settings if it leaks. Resend keeps the `+token` part (tested). Heads-up and reminder emails set this address as **Reply-To**, so "reply with anything new" works without the user knowing the address.
4. **Turn off open and click tracking.** Click tracking rewrites links, which would wrap our signed action links (§6.4), and we don't need the data.

## Answers

| Question | Answer | Source |
|---|---|---|
| Resend or Postmark: which has inbound to a webhook on the free tier? | **Resend.** Free plan: 3,000 emails a month and 100 a day (**received mail counts too**), 3 domains, 1 webhook endpoint, 30 days of logs. **Postmark** has no inbound on Free (100 emails a month) or Basic ($15); it starts on Pro. | [Resend pricing](https://resend.com/pricing), [Postmark pricing](https://postmarkapp.com/pricing) |
| Domain and DNS (SPF, DKIM, DMARC) | **Done, all on Vercel DNS** (where `giftsaf.com` was bought, in the GiftMe team). Both Resend domains verified within a minute. Records are listed [below](#dns-records). DMARC starts as `p=none` (monitor only). | Resend domains API, Gmail "Show original" |
| Address scheme | **Per-user token address** (see recommendation 3). Matching on the sender's address alone was rejected as the main route, because people forward from more than one account. Resend does report each sender's SPF, DKIM and DMARC results (`authentication` on the received email), so sender matching stays possible as a later fallback. | Test email to `notes+test123@in.giftsaf.com` |
| How are inbound webhooks signed? | **Svix signatures**: headers `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>`), an HMAC-SHA256 over `id.timestamp.rawBody` with the endpoint's `whsec_` secret. Verify against the **raw** body; reject timestamps more than 5 minutes off. The test receiver checks this by hand in 15 lines, and the `svix` package or `resend.webhooks.verify()` does the same. | [Verify webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests), `spikes/email/webhook.mjs` |

## What the tests showed

| Test | Result |
|---|---|
| **Send:** a heads-up-style email from `GiftsAF <hello@giftsaf.com>` to the owner's Gmail | Delivered, **Primary inbox**. Gmail: `spf=pass`, `dkim=pass header.i=@giftsaf.com`, `dmarc=pass`. The `email.delivered` webhook arrived 2 seconds later, signed. |
| **Receive:** the owner emailed `notes+test123@in.giftsaf.com` with a pasted screenshot and an attached photo | The `email.received` webhook arrived within seconds. Fetching the body and both attachments took 1.3 s, and both files downloaded byte for byte (507 KB PNG, 42 KB JPEG). `to` kept `+test123`. Sender's SPF, DKIM and DMARC: all pass. |
| **Forged webhook** (wrong signature) | Rejected with 401. |

## Things the build has to handle (W2-5, W4-3)

- **The webhook carries only metadata** (sender, recipient, subject, attachment ids). The handler must fetch the body (`GET /emails/receiving/{id}`) and attachments (`GET /emails/receiving/{id}/attachments`) from the API.
- **So the app's Resend key needs read access to received mail.** A "sending only" key can't do that. Use one full-access key, kept in Vercel env vars (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`).
- **Attachment download links expire after 1 hour.** Copy attachments into Supabase Storage straight away, while handling the webhook.
- **Pasted images arrive twice:** as an attachment, and again as a base64 image inside the HTML body (the test's HTML was 676 KB). Use the plain-text body plus the attachments, and ignore the HTML.
- **Answer the webhook fast, then do the work.** Return 200 first. Webhooks can be retried, so dedupe on `email_id`.
- **One webhook endpoint on the free plan.** Production gets it. To test inbound on `dev`, point it at a tunnel for the session, as this spike did. **[Verify]** whether a second Resend account for `dev` is worth it once W4-3 starts.
- **Quota:** 100 emails a day, sent and received combined. That's plenty for a few users. Resend's next plan is needed long before the public launch.
- **Tighten DMARC later:** move from `p=none` to `p=quarantine` once a few weeks of mail show nothing unexpected sending as `giftsaf.com`.

## DNS records

All on Vercel DNS for `giftsaf.com` (team GiftMe), added 2026-11-01. Resend domain ids: `giftsaf.com` 2538fe02…, `in.giftsaf.com` b504aa67….

| Name | Type | Value | Purpose |
|---|---|---|---|
| `resend._domainkey` | TXT | `p=MIGf…` (Resend's public key) | DKIM for sending |
| `send` | MX | `feedback-smtp.us-east-1.amazonses.com` (10) | Bounces (return path) |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | SPF |
| `rsend` | CNAME | `send.forge.rmta.net` | SPF (Resend) |
| `_dmarc` | TXT | `v=DMARC1; p=none;` | DMARC, monitor only |
| `in` | MX | `receive.forge.rmta.net` (10) | Inbound mail for `in.giftsaf.com` |
| `resend._domainkey.in` | TXT | `p=MIGf…` | DKIM for `in.giftsaf.com` |

## Accounts and cleanup

- Resend account: allensforever711@gmail.com (free plan).
- The spike key `gift-me-email-spike` (full access) is in `spikes/email/.env` (gitignored). **Delete it at the end of the spike;** it was pasted into a Claude session. W2-5 creates the app's own key.
- The test webhook pointed at a temporary Cloudflare tunnel. **Delete it** in Resend, or re-point it at production in W4-3.

## How to rerun

1. Put `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` in `spikes/email/.env`.
2. Run `node spikes/email/webhook.mjs` (listens on port 8787).
3. Run `cloudflared tunnel --url http://localhost:8787`, and point a Resend webhook at `<tunnel url>/resend`.
4. Email `anything@in.giftsaf.com`. The summary prints to the console, and the full email and attachments go to `spikes/email/out/` (gitignored).
