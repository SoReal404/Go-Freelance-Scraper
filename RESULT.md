# GO Freelance — Milestone 0: Realtime feasibility spike

**Status: done**

## What was built

- Added a Node.js spike at `worker/spike/freelancer-api-spike.mjs`.
- Verified a read-only request to the official Freelancer active projects API with the provided OAuth2 credential. The endpoint returned HTTP 200. The credential was held in process memory only and was not written to the workspace or printed.
- Ran both polling arms in parallel for 30 minutes: 20 seconds and 60 seconds. Each tracks project IDs from its initial baseline and logs each first-seen project's `time_submitted`, local `seen_at`, delay, and fields available.

## How to run / test it

Use Node.js 20+ and set `FREELANCER_OAUTH_TOKEN` in the process environment, then run:

```powershell
node worker/spike/freelancer-api-spike.mjs
```

The script requires API access, makes read-only calls, and writes JSON-lines progress and summary records to stdout. It does not print the token.

## Test output

Run window: `2026-09-28T09:45:53Z` to `2026-09-28T10:15:53Z` (30 minutes).

| Poll interval | First-seen projects | Median delay | P90 delay | Max delay | API calls | 429s | Other errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 seconds | 29 | 24.771 s | 21,768.457 s (~6 h 3 m) | 21,812.435 s (~6 h 3 m) | 85 | 0 | 0 |
| 60 seconds | 27 | 42.923 s | 21,776.082 s (~6 h 3 m) | 21,822.077 s (~6 h 4 m) | 30 | 0 | 0 |

The API returned project fields including `id`, `title`, `description`, `preview_description`, `time_submitted`, `jobs` (skills), `budget`, `currency`, `type`, and `seo_url`. Some first-seen projects had `time_submitted` more than six hours before the worker saw them. The cause of those stale appearances was not established in this spike. Fresh detections were much faster: the medians were about 25 seconds and 43 seconds.

## Decisions I made (and why)

- Website name: **GO Freelance**.
- **Conclusion: not yet good enough to promise reliable realtime from this endpoint/query alone.** Median detection is promising, but the P90 and maximum are around six hours because old-posted projects appeared in the feed late. The product's stated success measure includes those delays, so reporting only the fresh-project median would be misleading.
- Do not switch to scraping. First verify the API's ordering, pagination, and visibility behavior and repeat the spike with a query that reliably covers the newest projects. There were no rate-limit responses in this run.
- The Freelancer developer portal's rendered docs require JavaScript in the available text fetch. The official Freelancer Python SDK documents OAuth2 tokens and its project-search example; the active-project endpoint and OAuth header were additionally validated by the successful live read-only request.

## Problems / things I need the planner to decide

- Decide whether to investigate API ordering/pagination as a follow-up feasibility step before Milestone 1. The six-hour outliers need an explanation before the realtime claim can be accepted.
- The 30-minute sample contained 29 and 27 first-seen projects respectively. Treat the tail estimates as an initial feasibility signal, not a long-term service-level guarantee.

## Files changed

- `worker/spike/freelancer-api-spike.mjs`
- `RESULT.md`

## Milestone A: Mostaql

**Status: done**

**Data source used:** Plain Node `fetch` with a browser User-Agent returned a populated UTF-8 HTML page at `https://mostaql.com/projects?sort=latest` (HTTP 200). The page contained 25 project rows and no embedded project JSON (`__NEXT_DATA__` or `application/json` was absent). HTML parsing with Cheerio was sufficient; no browser automation was needed.

**Selector/endpoint details:** Listing `tbody[data-filter="collection"] tr.project-row`; title/link `.card--title h2 a[href*="/project/"]`; description `p.project__brief`; posted time `time[itemprop="datePublished"][datetime]`. The site presents the timestamp's naive `datetime` as UTC, consistent with its relative Arabic label. The listing does not expose project budget or skills, so those fields remain unset/empty. Sample HTML is saved at `worker/spike/samples/mostaql-listing.html`.

**Real 15-minute run — console output:**

```text
{"event":"spike_started","platform":"mostaql","started_at":"2026-09-29T00:31:24.537Z","duration_minutes":15}
{"event":"poll","poll":1,"baseline":true,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":2,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":3,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":4,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":5,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":6,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":7,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":8,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":9,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":10,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":11,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":12,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":13,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":14,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":15,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":16,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"poll","poll":17,"baseline":false,"rows":25,"parse_errors":0,"url":"https://mostaql.com/projects?sort=latest"}
{"event":"summary","platform":"mostaql","finished_at":"2026-09-29T00:46:24.546Z","elapsed_minutes":15,"polls":17,"unique_new_projects":0,"usable_timestamps":0,"parse_errors":0,"http_errors":0,"rough_projects_per_hour":0,"blocked":false}
```

No new URLs appeared during the run, so the live run had 0/0 timestamps among newly found projects; all 25 baseline rows parsed with timestamps. The short window's observed posting rate was 0/hour. This is an observation for that interval, not an estimate of Mostaql's usual project rate.

**Summary:** 0 new projects found; 0 parse errors; 0 HTTP errors; no challenge/CAPTCHA or block observed. A final adapter health check returned `{ "ok": true, "detail": "25 listing rows; 0 parse errors" }`. The adapter and parser typecheck cleanly, and four time-parser tests pass.

**Arabic time-parsing examples handled from the live page:** `منذ 43 دقيقة`, `منذ ساعتين`, and `منذ 3 ساعات`. Tests also cover an unrecognized label returning no timestamp. Exact `time[datetime]` is preferred when present.

**Known limitations / things that could break this scraper:** Only the newest 25 HTML rows were observed; this milestone did not test pagination. Budget and skills are not present in the listing. Selector or page changes will fail health checks or increment parse errors. No new project arrived during the 15-minute run, so live discovery of a newly posted project was not demonstrated. The initial workspace has no `/packages/shared`; the matching project/adapter interfaces currently live in `worker/adapters/types.ts` as temporary contracts for later relocation.

**Files changed:**

- `worker/adapters/mostaql.ts`
- `worker/adapters/mostaql.test.ts`
- `worker/adapters/types.ts`
- `worker/spike/mostaql-scrape-spike.mjs`
- `worker/spike/samples/mostaql-listing.html`
- `worker/package.json`, `worker/package-lock.json`, `worker/tsconfig.json`, `worker/.gitignore`

## Milestone E: Liveness triage

Checked 15 candidate platforms on 2026-09-29. Status refers to the site itself; notes say whether it qualifies as a public project/job feed. These checks were for triage only: no scraper code or authenticated access was used.

| Platform | Domain checked | Status | Listing URL | Note |
|---|---|---|---|---|
| Shoghlonline (شغل أون لاين) | [shoghlonline.com](https://shoghlonline.com/) | live | [Latest jobs](https://shoghlonline.com/jobs) | Populated public listings; search results show a recent post (“yesterday”) and multiple categories. Strong candidate. |
| Nafazly (نفذلي; domain spelling Nafezly) | [nafezly.com](https://nafezly.com/) | live | [Projects](https://nafezly.com/projects) | Listing returned project cards and recent-time labels; the homepage describes bidding on public projects. Strong candidate. |
| Ureed (أُريد) | [ureed.com](https://ureed.com/) | uncertain | [Find projects](https://app.ureed.com/find-projects) | Live route, but plain fetch produced a small JS shell; indexed filtered page showed no matching results. Could not verify a populated, recent public feed. |
| ArabWork (عرب وورك) | [arabwork.com](https://www.arabwork.com/) | live | — | Site is active, but its current offering is staffing/BPO outsourcing; no public freelance project/job feed found. Does not qualify for an adapter as requested. |
| FreelanceArabs (المستقلين العرب) | [arabsfreelancer.com](https://arabsfreelancer.com/) | live | [Projects](https://arabsfreelancer.com/projects/) | Public projects page exists; indexed content includes posts dated March 2026 and older posts, so there is some recent activity. Worth considering, with feed freshness/consistency to validate during the next milestone. |
| Khidmah (خدمة) | [khedmahonline.com](https://khedmahonline.com/) | live | — | Active micro-services marketplace; no public browse-projects/jobs board was found. It appears to focus on buying/selling packaged services. |
| Kafiil (كفيل) | [kafiil.com](https://kafiil.com/) | live | [Projects](https://kafiil.com/projects) | Current public feed includes projects posted within the last few days. One direct fetch timed out, while indexed pages confirmed active listings; retry gently if approved for build. |
| Bahr (بحر) | [bahr.sa](https://bahr.sa/) | live | [Projects](https://bahr.sa/projects?page=1) | Public project feed is populated (2,387 open projects shown) with examples dated 2026-09-20 to 2026-09-22; clearly active. |
| Jobbers (جوبرز) | [jobbers.io](https://www.jobbers.io/) | live | [Arabic jobs](https://www.jobbers.io/ar/job/) | Current domain and listing route found, but a polite direct request received HTTP 403 with a “Just a moment…” challenge. Marked blocked for scraping; no bypass attempted. |
| FreelanceMe (فريلانس مي) | [freelanceme.net](https://freelanceme.net/) | uncertain | — | The known language-switch route returned 404; no current public listing feed was verified. Search references describe an old Egypt freelancer/job-matching service, but do not establish present activity. |
| Ejada (إجادة) | [ejada.com](https://ejada.com/) | live | [Careers job search](https://careers.ejada.com/ar/job-search-advanced/) | Active enterprise IT company and internal careers page, not a public freelance project marketplace. Does not qualify. |
| Pioneers (رواد) | [pioneers.ws](https://pioneers.ws/ar/) | live | — | The checked site is Pioneers Space, a business/entrepreneur community and services site; no freelance project board found. |
| Taskat (current brand: Taskats) | [taskats.com](https://taskats.com/) | uncertain | [Browse jobs](https://taskats.com/jobs) | Current marketplace homepage and jobs route exist, but both exposed only a generic shell in the available page text; no recent public job cards/dates verified. |
| Idgaly (إدجلي) | [idgaly.com](https://idgaly.com/) | uncertain | — | Domain request failed and web search did not identify a reliable current project-listing page. Not enough evidence to call it definitively dead. |
| SouqAlmal (سوق المال) | [souqalmal.com](https://souqalmal.com/) | live | — | Current domain resolves to Yabi, a financial wellness product; no freelance project board. Does not qualify. |

**Recommendation:** Advance Shoghlonline, Nafezly, Kafiil, Bahr, and FreelanceArabs for planner review. Consider Ureed and Taskats only if a public listing can be verified in a browser-rendered session. Do not build Jobbers without explicit reconsideration of the challenge block; skip ArabWork, Khidmah, Ejada, Pioneers, and SouqAlmal because the current sites do not expose the requested kind of project board. FreelanceMe and Idgaly remain unverified/inactive candidates. Per the milestone gate, no adapters were built and no 15-minute runs were performed; waiting for the planner’s approval of the next batch.

## Milestone F: Adapters for currently usable public feeds

The user requested building every currently live candidate regardless of size, overriding the earlier wait-for-planner checkpoint. Three sources currently return parseable public project/job listing cards: Shoghlonline, Nafezly, and FreelanceArabs. Adapter IDs were added to the existing contract; `NormalizedProject` fields were not changed. Each adapter only requests one listing page, checks for a challenge, and waits 60 seconds per poll in worker use. The live soak uses randomized 48–72 second intervals and polls sites sequentially per source.

The 12-hour live run is **in progress**, not complete. A preliminary run was stopped after its broad Cloudflare marker check misclassified a normal Shoghlonline script and a scheduler bug made its second poll too early. Those were corrected before this run. One observed Nafezly label (`منذ دقيقتين`) also exposed a parser gap, which was fixed and covered by a test before this run started.

### Shoghlonline (شغل أون لاين)

Status: partial — adapter implemented; 12-hour live run in progress.

Data source used and why: one ordinary GET to `https://shoghlonline.com/jobs` returned a 277,868-byte populated UTF-8 page with 15 public job/project cards. Plain fetch is enough; no browser automation or detail-page requests.

Selector/endpoint details: `main h2 a[href^="/jobs/"]` identifies each card title/link; card ancestor `div.flex.items-start.gap-4` supplies its relative date (`h2`’s `.mt-1 span`), full listing description (`p.mt-3`), and named skill chips (`div.mt-3.flex.flex-wrap span`). The observed listing did not expose a budget. The URL slug is the external ID.

Real live run — console output so far (baseline only; the 12-hour run continues):

```text
{"event":"spike_started","platforms":["shoghlonline","nafezly","freelance-arabs"],"started_at":"2026-09-29T20:57:29.351Z","duration_hours":12,"log_file":"batch2-live-2026-09-29T20-57-29-351Z.jsonl","note":"Initial listing is the baseline. New IDs are detected from public listing pages; no project detail pages are fetched."}
{"event":"poll","platform":"shoghlonline","poll":1,"baseline":true,"rows":15,"projects":15,"parse_errors":0,"url":"https://shoghlonline.com/jobs"}
```

Summary so far: 15 baseline jobs; 0 parse errors; no new job claimed during the baseline. Budget is not shown in the public cards, so it stays undefined. Captured time labels include `أول أمس`, `الشهر الماضي`, and `قبل 11 شهرًا`.

Known limitations: listing is capped at the site’s current 15 cards; worker polls the default all-category listing only. A posting that is immediately removed or pushed out between polls cannot be recovered without pagination/history. No budget appears in the captured listing.

Files changed: `worker/adapters/shoghlonline.ts`, `worker/adapters/shoghlonline.test.ts`, and `worker/spike/samples/shoghlonline-listing.html`.

### Nafezly (نفذلي)

Status: partial — adapter implemented; 12-hour live run in progress.

Data source used and why: plain GET to `https://nafezly.com/projects` returned a populated UTF-8 listing. Current samples show 20 project cards with new listings, including a card posted two minutes before the diagnostic fetch.

Selector/endpoint details: `.project-box` is the card; `a.text-truncate[href*="/project/"]` supplies title, URL, and numeric ID; the card’s first `h3` supplies the listing description preview; `.fa-clock`’s parent supplies relative time; `.fa-usd-circle`’s parent supplies the budget range. Currency and numeric range are parsed when visibly present. Named skill tags are not in these cards.

Real live run — console output so far (baseline only; the 12-hour run continues):

```text
{"event":"poll","platform":"nafezly","poll":1,"baseline":true,"rows":20,"projects":20,"parse_errors":0,"url":"https://nafezly.com/projects"}
```

Summary so far: 20 baseline projects; 0 parse errors in the corrected run. One earlier observed `منذ دقيقتين` label failed before the parser was extended; the corrected parser handles it and the full current sample. Budget ranges such as `25 - 50 $` are captured as USD. The page’s description is a truncated preview, and the public listing does not show named skills.

Known limitations: only the default listing page is polled; site pagination is not traversed. Budget type (fixed/hourly) and skills are not reliably exposed in the observed cards and are left unset/empty. The description is only as complete as the list preview.

Files changed: `worker/adapters/nafezly.ts`, `worker/adapters/nafezly.test.ts`, and `worker/spike/samples/nafezly-listing.html`.

### FreelanceArabs (المستقلين العرب)

Status: partial — adapter implemented; activity freshness is uncertain; 12-hour live run in progress.

Data source used and why: one GET to `https://arabsfreelancer.com/projects/` returned a public WordPress project archive with 10 entries, card excerpts, and dates. No individual project pages are fetched. The newest observed archive date was March 4, 2026, so a currently active posting cadence is not demonstrated.

Selector/endpoint details: `div.projects[class*="post-"]` identifies cards; the `post-N` class is used as the external ID; `.fr-latest-content h3 a` is the title/link, `.fr-latest-container p` is the excerpt, and the second `.fr-latest-profile` contains the displayed date.

Real live run — console output so far (baseline only; the 12-hour run continues):

```text
{"event":"poll","platform":"freelance-arabs","poll":1,"baseline":true,"rows":10,"projects":10,"parse_errors":0,"url":"https://arabsfreelancer.com/projects/"}
```

Summary so far: 10 archive entries parsed; 0 parse errors. The archive exposes neither money nor human-readable skill names. Numeric skill taxonomy IDs embedded in CSS classes are intentionally not guessed or emitted as skills.

Known limitations: archive entries are not visibly marked open/closed; newest observed entry is several months old. Budget and named skills are absent from the listing. This is being polled because the user asked to include small live candidates, but the feed’s new-project activity is not yet proven.

Files changed: `worker/adapters/freelance-arabs.ts`, `worker/adapters/freelance-arabs.test.ts`, and `worker/spike/samples/freelance-arabs-listing.html`.

### Other live candidates: not scrape-ready

| Platform | Current finding | Decision |
|---|---|---|
| Kafiil | Prior indexed public feed showed recent projects, but the current polite requests timed out and then returned HTTP 502. | Blocked/unavailable for this run; no retry loop or bypass. |
| Bahr | Public URL and indexed project feed exist, but current direct fetch and rendered browser view showed the navigation/filter shell without visible project cards. | No reliable current data source to implement without guessing. |
| Ureed | Browser-rendered `app.ureed.com/find-projects` is blank; direct response is a small JS shell. | No public project rows exposed to parse. |
| Taskats | `/jobs` redirected to the homepage; rendered public page showed service categories and marketing content, not public job/project cards. | Does not currently expose the required feed. |
| Jobbers | Public route previously returned HTTP 403 with a browser challenge. | Blocked; no bypass. |
| ArabWork, Khidmah, Ejada, Pioneers, SouqAlmal | Current sites do not offer the requested public freelance project board. | Excluded as wrong service type. |
| FreelanceMe, Idgaly | Current public feed/domain could not be verified. | Excluded as unverified/inactive. |

### Live soak location and current verification

Run command: `cd worker; npm run spike:batch2` (12 hours by default; set `BATCH2_SPIKE_HOURS` to another positive duration). New-project events include title, listing description, displayed budget when available, skills when available, project URL, site-posted time, first-seen time, and age at first sight. The initial listing IDs form the baseline and are not reported as new.

Machine-readable append-only log: `worker/spike/logs/batch2-live-2026-09-29T20-57-29-351Z.jsonl`. Captured console: `worker/spike/logs/batch2-live-console-20260929-235728.log`. Process ID at launch: 3384. Startup confirmed all three sources returned populated parsed rows with zero parse errors; the 12-hour window has not finished, and no arrival rate or newly released project has yet been demonstrated.

Verification: `npm run typecheck` passed. `npm run test:batch2` passed 7 tests covering the observed Arabic time labels, date labels, budget parsing, and saved listing samples.

### Milestone F progress update (2026-09-30 00:01 Africa/Cairo)

The listing adapters now keep an in-process ID baseline: after the initial baseline, an ID that newly appears is returned even if its displayed `postedAt` falls outside the last polling interval. This avoids missing delayed listings solely because the platform’s post date is old. The tracker has a test proving that behavior. After four poll cycles, the current 12-hour process is still running; all three sources have returned rows on each observed poll with zero parse errors and no new project IDs so far. The full 12-hour result remains pending.

Latest captured console lines:

```text
{"event":"poll","platform":"freelance-arabs","poll":5,"baseline":false,"rows":10,"projects":10,"parse_errors":0,"url":"https://arabsfreelancer.com/projects/"}
{"event":"poll","platform":"shoghlonline","poll":5,"baseline":false,"rows":15,"projects":15,"parse_errors":0,"url":"https://shoghlonline.com/jobs"}
{"event":"poll","platform":"nafezly","poll":4,"baseline":false,"rows":20,"projects":20,"parse_errors":0,"url":"https://nafezly.com/projects"}
```

Updated verification: `npm run typecheck` passed; `npm run test:batch2` passed 8 tests, including the new-ID tracker behavior.
