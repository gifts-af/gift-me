# Gift Concierge: Feasibility of Building Recipient Preference Profiles

*Research date: 2026-10-17. This is not legal advice. Items marked **[unverified]** came only from secondary or vendor sources, or the sources conflicted. Check them before relying on them.*

---

## 1. Executive summary

- **Official APIs mostly cannot do this.** Almost every major platform now limits API reads to (a) the account that authorized your app, or (b) business or creator accounts. Typical friends and family have personal accounts, so neither path reaches them. Instagram Basic Display (personal accounts) was shut down on 2024-12-04. Facebook `user_posts` only covers people who granted your app permission. TikTok Display is for the authorizing user. TikTok Research is academic-only. LinkedIn's profile data is limited to partners. Letterboxd explicitly refuses recommendation, LLM and personal projects. Goodreads closed its API in 2020. Strava bans showing other users' data and bans AI use.
- **The usable official sources** are Bluesky (open, free, no auth for public feeds), X (pay-per-use at about $0.005 per post read **[unverified rate]**, but its policy restricts off-platform matching and inferring sensitive traits), YouTube (free quota, public data), and Reddit (free for non-commercial use, commercial use needs a contract).
- **Scraping is legally grey and commercially risky.** Logged-out scraping of public pages beat Meta's contract claim (*Meta v. Bright Data*, 2024). Logged-in or fake-account scraping lost (*hiQ v. LinkedIn* 2022, *Meta v. BrandTotal* 2022, Proxycurl, which shut down in 2025). Vendors such as Apify are cheap (about $1.50–5 per 1,000 results **[unverified]**) but fragile. A paid consumer app that depends on them inherits their ToS and privacy exposure.
- **A user-driven browser extension (the user clicks to clip what they are viewing) is the most defensible capture method.** It is the same pattern as web clippers and "save to wishlist" buttons. It is only defensible if each capture is a deliberate user action. Automated crawling of profiles while the user is logged in is the BrandTotal fact pattern, which lost.
- **Privacy law is the real blocker for a public product.** For personal use, the GDPR household exemption probably covers *you*, but Recital 18 says it does not cover a *provider* that supplies the means. A hosted commercial app is therefore a controller or processor for data about non-consenting third parties. That brings Art. 14 notice duties, a legitimate-interest balancing test, and erasure and objection rights. Profiles of children add COPPA and GDPR child-protection concerns. Clearview AI's €30.5M fine shows that EU regulators reject "it was public."
- **Recommendation.** For v1 (personal), use manual inputs, extension clipping, notes, guided questions, and LLM extraction. Do not scrape. For a public launch, make recipient opt-in (invite the recipient to fill in a profile or link a wishlist) the primary path. Treat clipped third-party content as user notes with minimization, short retention, no sensitive-trait inference, and no automated social-profile ingestion.

---

## 2. Per-platform feasibility table

Rating means feasibility of reading a non-consenting person's public content for a commercial gift-profiling app. Scale: Green = viable, Amber = limited or risky, Red = not viable through official channels.

| Platform | Official access to *another person's* content | Cost | ToS / policy risk | Rating |
|---|---|---|---|---|
| **Instagram** | Business Discovery reads only *business/creator* accounts, needs app review and a professional account of your own. Basic Display (personal) shut down 2024-12-04. | Free (rate-limited) | High. Meta terms ban unauthorized automated collection. Meta actively litigates. | Red (personal accounts) |
| **Facebook** | `user_posts` only for users who grant your app permission. No read of arbitrary profiles. | Free | High (same Meta terms) | Red |
| **Threads** | Keyword search of public posts after `threads_keyword_search` approval. Without approval, only the user's own posts. | Free (about 2,200 queries/24h per user) | Medium. Searching keywords is not the same as fetching a specific person's profile. Profiling purpose likely fails review. | Amber/Red |
| **TikTok** | Display API is for the authorizing user's own videos. Research API is academic and non-profit only, "commercial users" not eligible. | Free | High for scraping | Red |
| **X/Twitter** | Read any public post via API. Pay-per-use default since Feb 2026. | About $0.005 per post read **[unverified]**. Legacy Basic and Pro closed to new signups. | Medium. Restricted-use policy bars off-X matching and inferring sensitive traits. | Amber |
| **Pinterest** | v5 API scopes are for the authorizing user's boards and pins. Unclear whether other users' public boards can be read. Policy reportedly bars storing API data. | Free (approval required) | Medium/High **[unverified]** | Amber/Red |
| **Reddit** | Data API can read public user history. Free tier is non-commercial. Commercial use needs a separate agreement, OAuth tokens reportedly need manual approval. | Free (non-commercial). Commercial fees negotiated **[figures unverified]** | Medium. AI use of user content needs rightsholder permission. | Amber |
| **LinkedIn** | Profile API returns only the authenticated member. Everything else needs the Partner Program. | N/A | Very high (hiQ, Proxycurl injunctions) | Red |
| **YouTube** | Data API v3 reads public channels, videos, playlists, and *public* subscriptions. | Free, 10,000 units/day (list = 1 unit, search = 100) | Low/Medium (YouTube API Services policies apply; not reviewed here) | Green/Amber |
| **Bluesky** | Public AppView (`public.api.bsky.app`) `getAuthorFeed` and profiles without auth. Firehose and Jetstream are open. | Free | Low/Medium. Developer Guidelines apply (not retrieved). Strong community pushback on AI use of posts. | Green |
| **Strava** | API data may only be shown to the user it belongs to. AI use prohibited (since Nov 2024). | Free **[possible fee, unverified]** | Very high | Red |
| **Goodreads** | No new API keys since Dec 2020. | N/A | High for scraping | Red |
| **Letterboxd** | By request only. Explicitly *not* granted for recommendation, LLM/GPT, or private/personal projects. Public RSS feed per member exists. | N/A | High via API. RSS is a lighter option. | Red (API) / Amber (RSS) |
| **Amazon wishlists** | No official wishlist API. Conditions of Use ban robots, scrapers, and "data mining." | N/A | High for scraping. Low if the user pastes the link or clips the page. | Amber (user-clipped) |
| **Etsy** | Open API v3 has public listing endpoints. A public user-favorites endpoint was not confirmed. | Free (API key) | Medium | Amber **[unverified]** |
| **Target / other retailer registries** | No public consumer API found. | N/A | Clip via extension | Amber (user-clipped) |

---

## 3. Q1: Official API access and ToS, per platform

### Meta (Instagram, Facebook, Threads)
- **Instagram.** The Instagram API with Facebook Login has a Business Discovery endpoint that returns "basic metadata and metrics about other Instagram professional accounts". It excludes age-gated accounts. Personal accounts are not reachable. The Basic Display API (the only personal-account API) returned errors from 2024-12-04. Production use requires Meta App Review. Third-party guides describe a 200 calls/hour per-token limit **[unverified]**.
- **Facebook.** A post is readable only if "the owner has granted the `user_posts` permission" to your app. No public "read anyone's profile" path exists.
- **Threads.** Keyword search across public posts requires the `threads_keyword_search` permission (search added 2024-12-09). Official limit is 2,200 queries per rolling 24h.
- **ToS.** Instagram's terms forbid accessing or collecting information "in unauthorized ways". Meta defines scraping as automated access and collection, and runs dedicated anti-scraping teams. Meta's Automated Data Collection Terms (reportedly effective 2024-10-07) require express written permission for bots and crawlers **[secondary source]**.

### TikTok
- The Research API FAQ answers "No" to whether creators, advertisers, or commercial users are eligible. Eligibility is academic institutions in the US, EEA, UK, and Switzerland, plus certain non-profits.
- The Display API exposes `user.info.basic` and `video.list` for the authorizing user. The official doc wording ("a user's public videos") is less explicit than third-party guides about "own videos only."

### X / Twitter
- X ended the free tier for new signups on 2026-02-06 and made pay-per-use the default. Reads cost about $0.005 per post. The monthly read cap is reported as 2M or 3M **[conflicting]**.
- The restricted-use policy asks developers not to derive or infer sensitive characteristics (health including pregnancy, finances, politics, race, religion, sexual orientation, union membership, criminal history). It also defines and restricts "off-X matching", meaning linking an X username to an off-X individual. **A gift profile that ties @handle to "Aunt Sarah" in your database is plausibly off-X matching.** Read the English policy page and check permitted-use conditions.

### Pinterest
- v5 scopes (`boards:read`, `pins:read`, and others) apply to the authorizing account. Pinterest's privacy policy says public boards and Pins are "made available through APIs", but no confirmed endpoint lets a consumer app read an arbitrary user's boards **[unverified]**. Developer policy reportedly says "you may not store any information accessed through... the API" **[forum quote]**.

### Reddit
- Free OAuth tier is about 100 QPM, non-commercial. Commercial use needs a separate agreement at Reddit's discretion. Price figures circulating ($0.24/1K calls, $12K/yr minimum) are unconfirmed. Using user content for AI model training needs rightsholders' permission. Data API Terms were last revised 2026-07-20 **[per secondary source]**.

### LinkedIn
- Since 2015, broad API access is partner-only. The Profile API returns the authenticated member only. Historic terms barred storing data about people other than the member. Litigation history (below) makes LinkedIn the highest-risk target.

### YouTube
- Default quota is 10,000 units/day. List reads cost 1 unit and search costs 100. Extra quota is through a request form, and cannot be bought. Public channel, video, and playlist data is readable with an API key. YouTube API Services Developer Policies were not reviewed in this pass, so check them for profiling and storage limits.

### Bluesky / AT Protocol
- Public AppView endpoints (`app.bsky.feed.getAuthorFeed`, profiles) work without authentication. Rate limits are not published. Firehose and Jetstream stream all public posts.
- Social risk is high. A 1M-post Hugging Face dataset was withdrawn after backlash (Nov 2024). Bluesky proposed user-intent signals for "generative AI" and "bulk datasets" (Mar 2025, adoption status **[unverified]**). Respect any such signals.

### Hobby sites
- **Strava** (since 2024-11-11): third-party apps may display a user's data only to that user, and API data may not be used "in artificial intelligence models or similar applications". The June 2026 follow-up drops support for intermediaries **[secondary]**.
- **Goodreads:** no new keys since 2020-12-08, and terms barred storing data.
- **Letterboxd:** access is by request with no guaranteed reply. Not granted for "data-analysis, visualization or recommendation projects, LLM or GPT-related use, private or personal projects". Every profile has an **RSS feed**, which is a light, public, intended-for-syndication signal.

### Shopping wishlists
- **Amazon:** no wishlist API. Conditions of Use bar "any robot, spider, scraper, or other automated means." Apify actors that scrape public Amazon wishlists exist, which is a ToS violation. Best path: the *user* opens the shared list and clips it, or the recipient shares the link and you deep-link.
- **Etsy:** v3 has public endpoints with an API key. Favorites access was not confirmed.

---

## 4. Q2: Third-party data providers and scrapers

### What's available
| Type | Examples | Indicative cost | Notes |
|---|---|---|---|
| Scraper marketplaces | Apify actors (Instagram, Threads, Bluesky, Amazon wishlist) | Official IG scraper about $1.50 per 1K posts, $2.30 per 1K comments. Third-party actors $0.05–$5 per 1K **[unverified]** | Pay-per-result. Breaks when sites change. |
| Proxy / data infrastructure | Bright Data | Varies | Won against Meta on logged-out public scraping |
| LinkedIn data APIs | Proxycurl (**dead**, July 2025) and successors | n/a | Proxycurl was a roughly $10M-revenue business, shut down under a LinkedIn suit |
| People-data enrichment | People Data Labs | Free 100 credits/mo. Pro from about $98/mo. About $0.20–0.28 per person match. Enterprise $30K+ **[unverified]** | B2B-oriented (work and contact data). Weak on hobbies and tastes. Data-broker status raises privacy obligations. |

### Case law
- **hiQ v. LinkedIn** (9th Cir. 2019/2022; settled Dec 2022). Scraping *public* data was likely not "unauthorized access" under the CFAA. However, the district court held hiQ **breached LinkedIn's User Agreement** (scraping plus fake profiles). Consent judgment: $500,000 and a permanent injunction. The stipulations are non-precedential.
- **Meta v. Bright Data** (N.D. Cal., Jan 2024). Judge Chen held that **logged-out** scraping of public data was not "use" under Meta's terms, so there was no breach. Meta dismissed the case and waived appeal (Feb 2024). Bright Data says it made no concessions.
- **Meta v. BrandTotal** (2022). This involved a **browser extension and panel** that collected Facebook data. The court found ToS breaches and liability for **fake or purchased accounts**, with mixed CFAA results. Settled with a permanent injunction and a "significant" payment. **Most relevant precedent for an extension-based design.**
- **LinkedIn v. Proxycurl** (filed Jan 2025). Alleged fake accounts and scraping of non-public data. Permanent injunction requires deletion of the data and notice to customers. Company shut down 2025-07-04.
- **Meta v. Social Data Trading** (2021): Instagram public-profile scraping through bots, claims under ToS and Cal. Penal Code §502. Outcome not found.

### Risk for a consumer product
- The CFAA risk for logged-out public pages is low after hiQ. **Contract risk** applies if *your* service or your users are account holders who agreed to ToS. A consumer app's users almost always are.
- Platform countermeasures cause outages, and your core feature depends on a vendor that can vanish (Proxycurl).
- **Privacy law applies regardless of scraping legality.** Clearview AI was fined €30.5M by the Dutch DPA (decision 2024-05-16) for scraping public photos, plus transparency failures and missing an EU representative. "It was public" does not count as a GDPR legal basis.
- App store review (Apple 5.1.2) now requires explicit permission before sharing personal data with third-party AI. Data compiled about people who are not users is hard to square with that.

**Verdict:** acceptable for one-off personal experiments at most. Not a foundation for a paid product.

---

## 5. Q3: Browser extension approach

### How much it sidesteps
- **Sidesteps.** It avoids API approval and cost, works on personal and private accounts the *user* can already see, and covers any site (wishlists, product pages, Letterboxd, Goodreads, Strava).
- **Does not sidestep:**
  1. **Platform ToS.** The user is a logged-in account holder bound by the site's terms. Meta's terms prohibit *automated* collection. A user deliberately selecting and saving content looks like a web clipper or a "save" button. An extension that auto-scrolls, bulk-captures, or quietly harvests is the **BrandTotal** pattern (extension-based collection from logged-in sessions, which lost and was enjoined).
  2. **Privacy law.** The data is still about a non-consenting third party once it reaches your server (see §6).
  3. **Store policies** (below).

### Design rules that keep it defensible
- One capture per explicit user gesture (select text, right-click, "Clip to Mom's profile"). No background capture, no auto-pagination, no headless replay of the user's session, and no sending of cookies or tokens to your server.
- Capture the *selection* or a screenshot the user chose, not the full DOM or network responses.
- Do most extraction on the client, or send the minimum to the server.

### Store policies
- **Chrome Web Store** (Developer Program Policies; update published 2026-07-01, enforced from 2026-08-01):
  - Data collected must be *strictly necessary* to the disclosed single purpose.
  - **All** data collection must be prominently disclosed, even data closely related to the purpose (this broadens the older exemption).
  - Users must be proactively told about any later change in practices.
  - Prominent disclosure and consent must be *in the extension UI*, with an affirmative action. A store-listing disclosure is not enough.
  - Limited Use: browsing activity may be collected only for a prominently described user-facing feature. No ad targeting or other monetization.
  - Privacy policy required in the dashboard.
- **Firefox (AMO add-on policies):**
  - Transmit only what the function needs.
  - Personal data (including browsing activity) needs explicit **opt-in**. Browsing activity transmission is allowed only as the primary function.
  - The consent screen must be prominent, on a single page, with no dark patterns.
  - Firefox 140+ uses a built-in consent flow driven by manifest declarations.
  - No remote code. Encrypt data in transit.
- **Safari / Apple:** Safari Web Extensions ship through the App Store, so App Review Guidelines 5.1.1/5.1.2 apply. Since Nov 2025, apps must disclose and get **explicit permission before sharing personal data with third-party AI** (TechCrunch). Apple has historically barred building profiles or databases from data not provided by the user (paraphrase of older rules, **[verify exact current wording]**).

### Precedents
- Benign: web clippers (Evernote, Notion) and "save to wishlist" extensions such as Elfster's *Wish It!*, GiftList's extension, and the Pinterest Save button. All are user-initiated, single-item captures.
- Adverse: BrandTotal/UpVoice (Meta v. BrandTotal) shows that platforms will sue extension makers whose extensions harvest data from logged-in sessions.

---

## 6. Q4: Privacy and legal

### GDPR (EU/UK users, or EU/UK recipients)
- **Household exemption.** Art. 2(2)(c) and Recital 18 exempt processing "by a natural person... for purely personal or household activity", which explicitly includes social networking and online activity. **You, keeping notes about your mum for gifts, are very likely exempt.**
- **But Recital 18 says the GDPR "applies to controllers or processors which provide the means for processing personal data for such personal or household activities."** A hosted app (even free) is in scope for the data it processes.
- The CJEU reads the exemption narrowly: Lindqvist (C-101/01) on publishing to an indefinite audience, and Ryneš (C-212/13) on CCTV covering public space.
- **Public-product consequences:**
  - **Role.** If you decide the purposes and means (inference models, enrichment, retention), you are probably a *controller* for recipient data, not merely a processor.
  - **Lawful basis.** For non-consenting recipients the only realistic basis is legitimate interest (Art. 6(1)(f)), which requires a documented balancing test. Covert, comprehensive profiling of people with no relationship to you weighs against you. Clearview is the extreme example.
  - **Art. 14.** When data is not obtained from the data subject, you must inform them within a month. The Art. 14(5)(b) "disproportionate effort" exception is narrow. Gift-surprise use is awkward here.
  - **Data subject rights** (access, erasure, objection under Art. 21) for recipients who discover they are profiled.
  - **Art. 9 special categories.** Health, religion, sexual orientation, and politics easily surface from social media ("gift for someone recovering from surgery"). Inferring these generally needs explicit consent. **Block these inferences.**
  - **DPIA (Art. 35)** is very likely required: systematic profiling, data not obtained from the subject, possibly children.
  - **Art. 27 EU representative** if you are not established in the EU but target EU users.

### US state privacy laws
- **CCPA/CPRA (California).** Applies to businesses with revenue over $25M (inflation-adjusted, check the current figure with the CPPA) or that buy, sell, or share personal information of 100,000+ CA consumers or households. A startup may be under the thresholds initially.
  - The "publicly available" exclusion covers information the business reasonably believes the consumer lawfully made available to the general public. Sources disagree on breadth. One compliance FAQ says scraping social media is not a blanket exemption.
  - **Inferences drawn to create a profile are themselves "personal information"** under CCPA, so inferred preferences are covered even if the inputs were public.
  - Biometric data collected without the consumer's knowledge is excluded from "publicly available."
- **Virginia, Colorado and similar laws.** "Consumer" means a resident acting in an individual or household context. Thresholds are typically 100,000 consumers, or 25,000 plus over 50% of revenue from data sales. Most have publicly-available-data carve-outs, profiling opt-outs, and sensitive-data consent. Approximately 20 states have comprehensive laws as of 2026 **[count not verified in this pass]**.
- **Data-broker laws.** California's Delete Act and Vermont/Texas/Oregon registries apply to businesses that collect and sell data about consumers they have no direct relationship with. **If the product ever shares recipient profiles beyond the user (for example to retailers), it could look like a data broker.** Keep profiles strictly private to the user who created them.

### EU AI Act
- A gift recommender is not a prohibited practice and not Annex III high-risk. Profiling here does not drive employment, credit, or similar decisions. Art. 50 transparency obligations (AI interaction or generated-content disclosure) may apply.
- Timing changes: the Digital Omnibus (Reg. (EU) 2026/1744, in force 2026-07-27) delays Annex III high-risk obligations to 2027-12-02 and gives an Art. 50(2) grace period to 2026-12-02 for systems already on the market. Art. 5 prohibitions and Art. 4 AI-literacy duties have applied since 2025-02-02.
- **The GDPR, not the AI Act, is the binding constraint.**

### Children (gifts for kids)
- **COPPA.** It applies to operators of services *directed to children under 13* or with actual knowledge of collecting personal information *from* a child. A parent-facing app storing a parent's notes about their child is not the classic COPPA case. **Scraping a child's own social account** (TikTok and Instagram minimums are 13, but under-13s exist) or letting kids join as invited recipients would bring COPPA into play.
  - The amended COPPA Rule took effect 2025-06-23, with compliance required by **2026-04-22**. It covers stricter third-party disclosure consent, data retention limits, and security program requirements.
- **GDPR.** Children "merit specific protection" (Recital 38). Profiling minors weighs heavily against legitimate interest.
- **Recommendation:** for minors, use parent-entered information only. Never ingest a minor's social media. Flag recipient age and suppress automated social ingestion for under-18s.

### Personal use versus public product
| | Personal use (you, self-hosted or private) | Public paid product |
|---|---|---|
| GDPR | Very likely household-exempt for you | Provider is in scope. Controller duties for recipient data, Art. 14 notice, DPIA |
| US state laws | Not a "business" | Depends on thresholds. Inferences are personal information. Data-broker risk if shared. |
| Platform ToS | You personally bound. Low enforcement risk for manual clipping. | Company is a target (Meta and LinkedIn litigate). Store review. |
| Reputation | n/a | "App that secretly profiles your friends" is a predictable headline |

---

## 7. Q5: LLM and vision extraction of preferences

- **Feasibility is high.** Current multimodal LLMs read images and captions and output structured attributes (brands, hobbies, colours, aesthetic, sizes mentioned, wishlist items) reliably enough for gift ideation.
- **Research evidence (cuts both ways):**
  - Tömekçe et al. (ETH Zurich, NeurIPS 2024). VLMs inferred personal attributes from *incidental* images (objects and scenes, no people) with up to **77.6% accuracy**, improving with model capability.
  - Liu et al. 2025 ("Eye of Sherlock Holmes", HolmesEye). Agentic VLM+LLM profiling over personal photo sets reportedly **beats humans by 15% on abstract attributes such as personality**.
  - This shows the capability is real, and that the same capability is a recognized **privacy threat**. Regulators and platforms will view it that way.
- **Commercial examples:** Botsy AI (paste a recipient's Instagram, Facebook, TikTok, or Twitter link, it scans photos and captions and suggests Amazon products), Gift Seer, and Gifthuntr (Instagram username to gift ideas; Product Hunt, April 2023). How these access data, and whether they are still operating, was **not verified**. Their existence shows demand. It does not show compliance.
- **Implementation notes:**
  - Use a fixed extraction schema (interests, brands, colours/style, sizes, owned items to avoid, explicit wishes, dislikes) with per-field confidence and the source clip ID, so the user can see *why*.
  - Add a **sensitive-category guard** (health, religion, sexuality, politics, ethnicity, finances) that drops these at extraction time. X's policy explicitly requires this, and the GDPR Art. 9 analysis favours it.
  - Keep provenance so you can honour deletion: removing a clip removes the inferences derived from it.
  - Check the LLM provider's terms: no training on customer data, zero or limited retention, and usage policies on surveillance and profiling of individuals.

---

## 8. Q6: Alternatives that avoid the problems

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **Recipient opt-in profile** | User sends an invite link. The recipient fills a fun 2-minute "gift profile" (likes, sizes, no-gos, wishlist links). Optionally the recipient connects their *own* Pinterest, Spotify, Strava, Letterboxd, or YouTube via OAuth. | Consent-based. Unlocks official own-account APIs (Pinterest boards, TikTok Display, Instagram professional, Strava shown to that user only). Most accurate data. | Breaks the surprise for some. Needs a recipient-side flow. Strava API still bans AI use. |
| **Shared or universal wishlists** | Integrate with or import from Giftster, Elfster (Wish It!), GiftList, Giftful, Amazon and Target registries the recipient *shares*. | Explicit wishes. Built-in claim and dedupe. Social norm already exists. | No official Amazon API. Rely on shared links or user clipping. |
| **Family circle / group mode** | Everyone in a family group maintains their own profile and sees others'. Network effect. | Each person is a user who consented. Viral loop. | Product scope grows. |
| **Guided questions plus memory prompts** | The user answers "What did they mention wanting lately?" style questions. Mobile quick notes ("Dad said his headphones broke"). | Zero third-party data. Highest-signal data in practice. | Depends on user effort. |
| **User-initiated clipping** | Extension or share-sheet clip of a post, product, or article, saved to a person. | Flexible. Mirrors existing clipper norms. | Still third-party personal data. Needs minimization. |
| **RSS / open protocols** | Letterboxd RSS, Bluesky public feeds. Only when the user adds the handle and only for the active gift task. | Officially public, syndication-intended | Bluesky user-intent signals. Limited platforms. |
| **"Ask a mutual" / anonymous hint request** | Send the recipient or their partner a low-key "help me pick" link | Consent, keeps surprise | Friction |

---

## 9. Recommended approach

### v1: personal use (now)
1. **Inputs:** guided questionnaire, mobile quick notes, **user-initiated** extension clips (selection, screenshot, or URL plus page title), pasted wishlist and product links.
2. **No server-side scraping and no third-party scraper vendors.** For Bluesky, YouTube, and Letterboxd RSS, optional on-demand fetch of public data is fine. Skip Instagram, Facebook, TikTok, and LinkedIn automation entirely.
3. **LLM extraction** into a structured preference schema with provenance, confidence, and a sensitive-category filter.
4. **Build privacy-by-design now** (cheap now, costly later): per-person delete, clip-level provenance, retention timer (for example auto-expire raw clips after N days, keep only the distilled preferences), encryption, and no third-party sharing.
5. **Extension architecture:** Manifest V3, `activeTab` and context-menu permissions only (no `<all_urls>` host access if avoidable), in-UI disclosure and consent screen, no remote code. This already satisfies Chrome's 2026 policy and Firefox opt-in.

### Public launch
1. **Lead with consent:** recipient invite to profile, shared wishlists, family circles. Market it as "the gift profile your family fills in together."
2. **Own-account integrations through OAuth** for recipients who opt in (Pinterest, YouTube, Spotify, and similar). Avoid Strava for AI features.
3. **Keep user notes and clips** but treat them as the *user's* private notes about a person:
   - minimization (clip only what's needed)
   - no automated social-profile ingestion of non-users
   - no sensitive inferences
   - short raw-data retention
   - never shared, sold, or used across users (avoid data-broker classification)
   - honour recipient requests (a public "remove me / see my data" page)
4. **Before launch:** commission a privacy-counsel review. Write a GDPR legitimate-interest assessment and DPIA. Decide whether to geo-limit (US-first) at launch. Prepare CCPA/state-law notices. Name an EU representative if serving the EU. Verify COPPA posture (no under-13 users or recipients' own data).
5. **Kids:** parent-entered data only. Age flag on the recipient record disables any web or social ingestion.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Platform ToS action, cease-and-desist, or lawsuit (Meta, LinkedIn) | Medium if scraping, low if user-clipping only | High | No scraping. User-gesture capture only. |
| GDPR complaint from a profiled recipient | Medium (public product) | High (fines, orders) | Consent-first design, Art. 14 strategy, DPIA, deletion page |
| Extension store rejection or removal | Medium | High (distribution) | Minimal permissions, in-UI consent, single purpose |
| Apple rejection (5.1.2, third-party AI sharing) | Medium | Medium | Explicit permission UI for AI processing |
| Scraper vendor shutdown or breakage | High | High | Don't depend on them |
| Sensitive-trait inference leak (pregnancy, health) | Medium | High (harm, reputation) | Extraction-time filter, no storage |
| "Creepy" PR narrative | Medium | High | Opt-in framing, transparency |
| Children's data | Low-Medium | High | Parent-entered only |

---

## 11. Open questions
1. Exact current text of X's restricted-use cases (English) and whether a private gift profile counts as "off-X matching."
2. Pinterest: does any v5 endpoint expose a *non-authorizing* user's public boards? What exactly does the storage prohibition say?
3. Bluesky Developer Guidelines text (page was not retrievable) and status of the user-intent / AI-consent proposal.
4. Reddit commercial pricing and the Data API Terms (rev. 2026-07-20) wording on profiling individuals.
5. YouTube API Services Developer Policies on storing and profiling public user data.
6. Whether Art. 14(5)(b) "disproportionate effort" or a "surprise gift" rationale has any DPA guidance. Probably none, so counsel is needed.
7. Current inflation-adjusted CCPA revenue threshold and the full list of state laws in force by launch date.
8. Strava's June 2026 changes and any developer fee (only secondary reporting found).
9. Etsy v3 favorites endpoint and scope.
10. Do competitors (Botsy, Gift Seer, Gifthuntr) still operate, how do they get Instagram data, and have they faced enforcement?
11. Apple's exact current 5.1.2 wording on compiling data not provided by the user.

---

## 12. Sources

**Platform APIs and terms**
- Meta Business Discovery: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery ; https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Instagram Basic Display deprecation: https://developers.secure.facebook.com/docs/instagram-basic-display-api/overview ; https://help.zapier.com/hc/en-us/articles/32429170578317-Instagram-app-deprecation-on-Dec-4-2024
- Facebook Post / user_posts: https://developers.facebook.com/docs/graph-api/reference/post ; https://developers.secure.facebook.com/docs/graph-api/changelog/version2.3
- Threads keyword search: https://developers.facebook.com/documentation/threads/keyword-search ; https://developers.facebook.com/documentation/threads/changelog
- Instagram scraping policy: https://help.instagram.com/740480200552298
- Instagram API guides (secondary): https://www.getphyllo.com/post/instagram-api-guide ; https://storrito.com/resources/Instagram-API-2026
- TikTok Research API FAQ: https://developers.tiktok.com/docs/en/research-api-faq ; Display API: https://developers.tiktok.com/doc/display-api-overview/
- X pricing (secondary): https://opentweet.io/x-api-pricing ; https://zernio.com/blog/twitter-api-pricing ; https://bundle.social/blog/x-api-pricing-2026-costs-limits
- X restricted use cases: https://docs.x.com/ko/developer-terms/restricted-use-cases ; https://developer.x.com/en/support/x-api/policy
- Pinterest (secondary): https://www.ayrshare.com/solutions/pinterest-api-v5-transition-the-complete-developer-guide/ ; https://community.pinterest.biz/t/saving-user-pin-id/40357 ; https://conductatlas.com/platform/pinterest/pinterest-privacy-policy/public-content-visible-to-anyone-via-apis/
- Reddit (secondary): https://octolens.com/blog/reddit-api-pricing ; https://coldiq.com/blog/best-reddit-apis ; https://www.xpoz.ai/blog/guides/reddit-api-pricing-tiers-and-alternatives/ ; https://vorplabs.com/agent-tools/reddit-data-api
- LinkedIn: https://techcrunch.com/2015/02/12/linkedin-battens-down-the-hatches-on-api-use-limiting-full-access-to-partners ; https://learn.microsoft.com/en-ca/linkedin/compliance/announcements/data-restrictions ; https://www.salesforge.ai/blog/linkedin-api
- YouTube Data API: https://developers.google.com/youtube/v3/getting-started ; https://www.getphyllo.com/post/is-the-youtube-api-free-in-2026-quota-limits-costs-when-to-pay
- Bluesky: https://bsky.network/docs/protocol-services ; https://techcrunch.com/2025/03/15/bluesky-users-debate-plans-around-user-data-and-ai-training/ ; https://www.neowin.net/news/bluesky-may-not-train-ai-on-your-posts-but-others-can-and-users-are-furious/ ; https://apify.com/bovi/bluesky-scraper
- Strava: https://cyberinsider.com/strava-tightens-api-policies-to-bolster-user-privacy-and-security/ ; https://techrepublic.com/article/news-strava-api-scraping-crackdown ; https://insider.fitt.co/strava-updates-data-policy-affecting-third-party-apps
- Goodreads: https://waxy.org/2020/12/amazon-owned-goodreads-quietly-shutters-api/ ; https://janefriedman.com/goodreads-closing-off-access-to-its-data-making-it-less-useful/
- Letterboxd API: https://letterboxd.com/api-beta/
- Amazon Conditions of Use (secondary): https://conductatlas.com/platform/amazon/amazon-conditions-of-use/provision/CA-P-018441/prohibition-on-data-mining-and-scraping-tools/ ; https://apify.com/truenorth/amazon-wishlist-scraper
- Etsy: https://www.etsy.com/developers/documentation/getting_started/api_basics ; https://github.com/gordonturner/etsy-open-api-client

**Scraping, vendors, and case law**
- Meta v. Bright Data: https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued ; https://www.fbm.com/post/102kqw7/ ; https://techcrunch.com/2024/02/26/meta-drops-lawsuit-against-web-scraping-firm-bright-data-that-sold-millions-of-instagram-records ; https://blog.ericgoldman.org/archives/2024/02/facebook-drops-anti-scraping-lawsuit-against-bright-data-guest-blog-post.htm
- hiQ v. LinkedIn: https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ ; https://newmedialaw.proskauer.com/2022/12/08/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case/
- Meta v. BrandTotal: https://news.bloomberglaw.com/litigation/meta-gets-win-in-hacking-competition-case-against-data-scraper ; https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data/ ; https://blog.ericgoldman.org/?p=24074
- Meta v. Social Data Trading complaint: https://www.jurist.org/news/wp-content/uploads/sites/4/2021/12/Meta-Platforms-Inc.-v.-Social-Data-Trading-Ltd.pdf
- Proxycurl: https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/ ; https://nubela.co/blog/goodbye-proxycurl/
- Apify pricing: https://use-apify.com/docs/how-to-use-apify/scrape-instagram ; https://www.socialcrawl.dev/blog/best-instagram-data-apis-2026
- People Data Labs (secondary): https://fullenrich.com/content/people-data-labs-pricing ; https://enrichlayer.com/blog/people-data-labs-pricing
- Clearview AI fine: https://hunton.com/privacy-and-information-security-law/dutch-regulator-fines-clearview-ai-30-5-million-euros ; https://www.freevacy.com/news/dutch-dpa/dutch-dpa-fines-clearview-ai-eur30m/5645

**Extension and app store policies**
- Chrome user data FAQ: https://developer.chrome.com/docs/webstore/user_data/
- Chrome 2026 policy update: https://developer.chrome.com/blog/cws-policy-updates-2026
- Firefox add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Apple 5.1.2 and third-party AI: https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai ; https://developer.apple.com/forums/thread/750319

**Privacy law**
- GDPR Recital 18 / household exemption: https://presencis.com/regulations/gdpr/recital-18/ ; https://www.hoganlovells.com/en/publications/cctv-cjeu-narrows-the-scope-of-the-household-exemption ; https://inforrm.org/2016/07/14/i-tweet-therefore-i-am-subject-to-data-protection-law-brendan-van-alsenoy/
- CCPA: https://oag.ca.gov/ccpa ; https://www.truevault.com/learn/ccpa/what-is-publicly-available-information-under-the-ccpa ; https://www.bytebacklaw.com/2022/01/how-do-the-cpra-cpa-vcdpa-treat-publicly-available-information/
- Virginia / Colorado: https://www.dataprotectionreport.com/2021/03/virginias-new-consumer-data-protection-act/ ; https://www.thompsoncoburn.com/insights/colorado-enacts-consumer-privacy-law-becoming-third-state-to-do-so-102jc7i/
- COPPA amendments: https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule ; https://bassberry.com/news/amendments-to-the-coppa-rule-now-in-effect/
- EU AI Act Digital Omnibus: https://cdp.cooley.com/digital-ai-omnibus-delays-key-deadlines-introduces-new-rules/ ; https://www.winstontaylor.com/insights/ai-act-rules-on-high-risk-ai-delayed-as-ai-digital-omnibus-agreed ; https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/

**LLM and vision inference, competitors**
- Tömekçe et al. 2024: https://www.arxiv.org/pdf/2404.10618 ; https://mlanthology.org/neurips/2024/tomekce2024neurips-private/
- Liu et al. 2025 (HolmesEye): https://arxiv.org/abs/2505.19139v1
- Botsy AI: https://www.logicweb.com/?p=46403 ; Gift Seer: https://www.trendhunter.com/trends/gift-seer ; Gifthuntr: https://www.hunted.space/product/gift-ideas-based-on-instagram/launches/gifthuntr

**Wishlist alternatives**
- https://giftlist.com/blog/10-best-universal-wishlist-apps-in-2025-ranked-and-reviewed ; https://giftlist.com/blog/elfster-alternatives ; https://chromewebstore.google.com/detail/fhjanlpjlfhhbhbnjohflphmfccbhmoi ; https://maketecheasier.com/best-wishlist-apps
