/**
 * Shared HTTP layer for every scraper request.
 *
 * What it does, in order, for each request:
 *   1. Identifies itself honestly (SCRAPER_USER_AGENT), never as a browser.
 *   2. Checks the site's robots.txt (with * and $ wildcard support, Google-style
 *      longest-match rules) and refuses disallowed URLs.
 *   3. Spaces requests per host, even across listing + detail fetches.
 *   4. Backs off a host after 403 / 429 / 503 instead of retrying, honoring Retry-After.
 *   5. Follows redirects manually so a redirect cannot land on a disallowed path.
 *
 * Official APIs (Freelancer.com) pass { skipRobots: true }; they still get pacing and backoff.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

const PRODUCT_TOKEN = 'gofreelancebot';

function userAgentFromEnv(): string {
  const custom = process.env.SCRAPER_USER_AGENT?.trim();
  if (custom) return custom;
  const contact = process.env.SCRAPER_CONTACT?.trim() || 'set SCRAPER_CONTACT in .env';
  return `GoFreelanceBot/1.0 (project aggregator; contact: ${contact})`;
}

export const SCRAPER_USER_AGENT = userAgentFromEnv();

/** Scraped (HTML) sources are polled no faster than this. Clamped to >= 2 minutes. */
export const SCRAPE_POLL_INTERVAL_MS =
  Math.max(120, Number(process.env.SCRAPE_POLL_SECONDS) || 300) * 1000;

// ---------------------------------------------------------------------------
// robots.txt parsing and matching
// ---------------------------------------------------------------------------

export function parseRobots(text: string, productToken = PRODUCT_TOKEN): RobotsPolicy {
  type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything"; an empty Allow means nothing. Neither adds a rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && productToken.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: chosen.map((g) => g.crawlDelay).find((d) => d !== undefined),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/** Google semantics: the longest matching pattern wins; Allow wins a tie; no match means allowed. */
export function isPathAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  let best: RobotsRule | undefined;
  for (const rule of policy.rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// Polite HTTP client
// ---------------------------------------------------------------------------

export class RobotsDisallowedError extends Error {
  url: string;
  constructor(url: string) {
    super(`Skipped ${url}: disallowed by robots.txt`);
    this.name = 'RobotsDisallowedError';
    this.url = url;
  }
}

export class HostCooldownError extends Error {
  host: string;
  retryAt: number;
  constructor(host: string, retryAt: number) {
    super(`Skipped ${host}: backing off until ${new Date(retryAt).toISOString()} after a block/rate-limit response`);
    this.name = 'HostCooldownError';
    this.host = host;
    this.retryAt = retryAt;
  }
}

export interface PoliteRequest {
  accept?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Official APIs only. robots.txt governs crawlers, not authenticated API calls. */
  skipRobots?: boolean;
}

export interface PoliteHttpOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  minGapMs?: number;
  robotsTtlMs?: number;
}

interface HostState {
  nextSlotAt: number;
  cooldownUntil: number;
  consecutiveBlocks: number;
}

interface RobotsCacheEntry {
  policy: RobotsPolicy | 'unavailable';
  expiresAt: number;
}

const BLOCK_STATUSES = new Set([403, 429, 503]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
const BASE_COOLDOWN_MS = 5 * 60 * 1000;

export function createPoliteHttp(options: PoliteHttpOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const userAgent = options.userAgent ?? SCRAPER_USER_AGENT;
  const minGapMs = options.minGapMs ?? (Number(process.env.MIN_REQUEST_GAP_MS) || 3000);
  const robotsTtlMs = options.robotsTtlMs ?? 6 * 60 * 60 * 1000;

  const hosts = new Map<string, HostState>();
  const robotsCache = new Map<string, RobotsCacheEntry>();

  const stateFor = (host: string): HostState => {
    let s = hosts.get(host);
    if (!s) {
      s = { nextSlotAt: 0, cooldownUntil: 0, consecutiveBlocks: 0 };
      hosts.set(host, s);
    }
    return s;
  };

  /** Reserve the next request slot for this host (synchronously, so concurrent callers queue up), then wait for it. */
  async function takeSlot(host: string, gapMs: number): Promise<void> {
    const s = stateFor(host);
    if (s.cooldownUntil > now()) throw new HostCooldownError(host, s.cooldownUntil);
    const slot = Math.max(now(), s.nextSlotAt);
    s.nextSlotAt = slot + gapMs;
    const wait = slot - now();
    if (wait > 0) await sleep(wait);
  }

  function recordResponse(host: string, response: Response): void {
    const s = stateFor(host);
    if (BLOCK_STATUSES.has(response.status)) {
      s.consecutiveBlocks += 1;
      const retryAfter = Number(response.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_COOLDOWN_MS * 2 ** (s.consecutiveBlocks - 1);
      s.cooldownUntil = now() + Math.min(backoff, MAX_COOLDOWN_MS);
    } else if (response.ok) {
      s.consecutiveBlocks = 0;
    }
  }

  async function loadPolicy(origin: string, host: string): Promise<RobotsPolicy | 'unavailable'> {
    const cached = robotsCache.get(origin);
    if (cached && cached.expiresAt > now()) return cached.policy;

    let policy: RobotsPolicy | 'unavailable';
    try {
      await takeSlot(host, minGapMs);
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*;q=0.5' },
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      });
      if (res.ok) policy = parseRobots(await res.text());
      else if (res.status >= 400 && res.status < 500 && res.status !== 429) policy = { rules: [] }; // no robots.txt: no restrictions
      else policy = 'unavailable'; // 5xx / 429: be conservative
    } catch (error) {
      if (error instanceof HostCooldownError) throw error;
      policy = 'unavailable';
    }

    // Retry an unavailable robots.txt after 10 minutes instead of caching the failure for hours.
    robotsCache.set(origin, { policy, expiresAt: now() + (policy === 'unavailable' ? 10 * 60 * 1000 : robotsTtlMs) });
    return policy;
  }

  async function assertAllowed(url: URL): Promise<number> {
    const policy = await loadPolicy(url.origin, url.host);
    if (policy === 'unavailable') {
      throw new Error(`Skipped ${url.href}: robots.txt for ${url.host} could not be read, retrying later`);
    }
    if (!isPathAllowed(policy, `${url.pathname}${url.search}`)) throw new RobotsDisallowedError(url.href);
    return Math.max(minGapMs, (policy.crawlDelaySeconds ?? 0) * 1000);
  }

  async function get(input: string, request: PoliteRequest = {}): Promise<Response> {
    let url = new URL(input);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const gapMs = request.skipRobots ? minGapMs : await assertAllowed(url);
      await takeSlot(url.host, gapMs);

      const response = await fetchImpl(url.href, {
        headers: {
          Accept: request.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
          ...request.headers,
          'User-Agent': userAgent,
        },
        signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
        redirect: 'manual',
      });
      recordResponse(url.host, response);

      const location = response.headers.get('location');
      if (REDIRECT_STATUSES.has(response.status) && location) {
        url = new URL(location, url);
        continue;
      }
      return response;
    }
    throw new Error(`Too many redirects starting at ${input}`);
  }

  return { get, userAgent, _hostState: hosts, _robotsCache: robotsCache };
}

export const http = createPoliteHttp();
