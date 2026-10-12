# Changes in this review

## Security
- **Removed the hardcoded Freelancer.com OAuth token** from `adapters/freelancer.ts`. The token now comes only from `FREELANCER_OAUTH_TOKEN`. If that file was ever pushed to GitHub, treat the token as leaked and generate a new one.
- **Supabase writes now use `SUPABASE_SERVICE_ROLE_KEY`** (server only). The anon key is public, so writing with it meant the table had to accept anonymous writes. SQL to make the table read-only for visitors is at the top of `storage/supabase-store.ts`.
- `.env` is no longer shipped; `.env.example` added. `.gitignore` now also covers `.env.*` and `data/*.json`.

## Respecting the sites
- New `net/polite-http.ts`: every scraper request now goes through it.
  - Honest user-agent (`GoFreelanceBot/1.0 (... contact: $SCRAPER_CONTACT)`) instead of a fake Chrome one.
  - Reads each site's robots.txt at runtime (wildcards, `$`, longest-match, Crawl-delay) and refuses disallowed URLs, including redirects onto disallowed paths. Tested against the real Mostaql, PeoplePerHour and Nafezly files. If robots.txt cannot be read (5xx), it skips instead of guessing.
  - Minimum gap per host across listing AND detail requests (default 3s).
  - Backs off a host for 5 min to 1 h after 403/429/503 (honors Retry-After) instead of retrying every minute.
- Scraped sites are polled every 5 minutes (was 60s; `SCRAPE_POLL_SECONDS`, minimum 120). Each adapter now really uses its own `pollIntervalMs`; the old engine ignored it.
- Fixed double requests: when a site-specific enricher failed, the generic enricher re-fetched the same URL.
- Freelancer.com is never scraped as HTML any more (the enricher used to fall back to the website). It uses the API only.

## Reliability
- A failed Supabase upsert used to be lost forever (the project was already marked as seen locally). Failures are now queued and retried every cycle. `npm run sync` pushes the whole local file to Supabase for backfill.
- Local JSON store: one file rewrite per adapter per cycle instead of one per project, and compact JSON.
- SIGTERM is handled (systemd / Docker / pm2) and shutdown no longer waits out a 60s sleep.
- PeoplePerHour's new-listing tracker was re-created on every poll; it now persists.
- `tsc` now checks the whole worker (it only covered `adapters/`), and the dead Upwork/Guru adapters that broke it were removed.

## Still to do on your side
- Rotate the Freelancer.com token and put the new one in `.env` on the server.
- Set `SCRAPER_CONTACT` in `.env` (an email or your site URL).
- Check robots.txt for `shoghlonline.com` and `arabsfreelancer.com` (the runtime check now enforces them, but read them once).
- Run the Supabase SQL (read-only for anon) and switch the server to the service-role key.
- The `spike/` scripts are old experiments and still use plain `fetch`; don't run them against live sites.
