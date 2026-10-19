import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPoliteHttp,
  HostCooldownError,
  isPathAllowed,
  parseRobots,
  RobotsDisallowedError,
} from './polite-http.ts';

const MOSTAQL = `User-agent: *
Disallow: /search*
Disallow: /ajax/
`;

const PPH = `# Allow all robots to access our site
User-agent: *
Disallow: /*?
Allow: /*?page=

# Disallowed pages
Disallow: /member/portfolioItems
Disallow: /job/bidders*
Disallow: /directory
Disallow: /job/new*
Disallow: /*/wp-admin/
`;

const NAFEZLY = `User-agent: *
Sitemap: https://nafezly.com/sitemap.xml
Allow: 
`;

test('Mostaql: listing and detail pages allowed, search and ajax blocked', () => {
  const policy = parseRobots(MOSTAQL);
  assert.equal(isPathAllowed(policy, '/projects?sort=latest'), true);
  assert.equal(isPathAllowed(policy, '/project/123456-some-slug'), true);
  assert.equal(isPathAllowed(policy, '/search?q=python'), false);
  assert.equal(isPathAllowed(policy, '/ajax/load-more'), false);
});

test('PeoplePerHour: query strings are blocked unless the query starts with page=', () => {
  const policy = parseRobots(PPH);
  assert.equal(isPathAllowed(policy, '/freelance-jobs'), true);
  assert.equal(isPathAllowed(policy, '/freelance-jobs?page=2'), true);
  assert.equal(isPathAllowed(policy, '/freelance-jobs?category=tech&page=2'), false);
  assert.equal(isPathAllowed(policy, '/freelance-jobs?utm_source=x'), false);
  assert.equal(isPathAllowed(policy, '/freelance-jobs/technology-programming/web/some-job-4525205'), true);
  assert.equal(isPathAllowed(policy, '/job/bidders/4525205'), false);
  assert.equal(isPathAllowed(policy, '/job/new'), false);
  assert.equal(isPathAllowed(policy, '/directory'), false);
});

test('Nafezly: empty Allow means everything is open', () => {
  const policy = parseRobots(NAFEZLY);
  assert.equal(isPathAllowed(policy, '/projects'), true);
  assert.equal(isPathAllowed(policy, '/project/55-anything'), true);
});

test('a group naming our bot overrides the * group', () => {
  const policy = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: GoFreelanceBot\nDisallow: /private\n`);
  assert.equal(isPathAllowed(policy, '/projects'), true);
  assert.equal(isPathAllowed(policy, '/private/x'), false);
});

test('Crawl-delay is read and $ anchors work', () => {
  const policy = parseRobots(`User-agent: *\nCrawl-delay: 7\nDisallow: /*.pdf$\n`);
  assert.equal(policy.crawlDelaySeconds, 7);
  assert.equal(isPathAllowed(policy, '/a/file.pdf'), false);
  assert.equal(isPathAllowed(policy, '/a/file.pdf.html'), true);
});

function harness(robotsBody: string, robotsStatus = 200, pageStatus = 200, pageHeaders: Record<string, string> = {}) {
  let clock = 1_000_000;
  const calls: Array<{ url: string; ua: string | undefined }> = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: (init?.headers as Record<string, string>)?.['User-Agent'] });
    if (url.endsWith('/robots.txt')) return new Response(robotsBody, { status: robotsStatus });
    return new Response('<html></html>', { status: pageStatus, headers: pageHeaders });
  }) as unknown as typeof fetch;
  const http = createPoliteHttp({
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    userAgent: 'GoFreelanceBot/1.0 (test)',
    minGapMs: 3000,
  });
  return { http, calls, sleeps, advance: (ms: number) => { clock += ms; } };
}

test('sends the honest user-agent and fetches robots.txt only once per origin', async () => {
  const { http, calls } = harness(MOSTAQL);
  await http.get('https://mostaql.com/projects?sort=latest');
  await http.get('https://mostaql.com/project/1-a');
  assert.equal(calls.filter((c) => c.url.endsWith('/robots.txt')).length, 1);
  assert.ok(calls.every((c) => c.ua === 'GoFreelanceBot/1.0 (test)'));
});

test('refuses a disallowed URL without requesting it', async () => {
  const { http, calls } = harness(MOSTAQL);
  await assert.rejects(http.get('https://mostaql.com/search?q=x'), RobotsDisallowedError);
  assert.ok(!calls.some((c) => c.url.includes('/search')));
});

test('skipRobots (official API) never fetches robots.txt', async () => {
  const { http, calls } = harness(MOSTAQL);
  await http.get('https://www.freelancer.com/api/projects/0.1/projects/active/', { skipRobots: true });
  assert.ok(!calls.some((c) => c.url.endsWith('/robots.txt')));
});

test('requests to the same host are spaced by the minimum gap', async () => {
  const { http, sleeps } = harness(NAFEZLY);
  await http.get('https://nafezly.com/projects');
  await http.get('https://nafezly.com/project/1-a');
  assert.ok(sleeps.some((ms) => ms >= 2900), `expected a ~3s wait, got ${JSON.stringify(sleeps)}`);
});

test('429 puts the host into cooldown and later calls fail fast', async () => {
  const { http, calls, advance } = harness(NAFEZLY, 200, 429, { 'retry-after': '120' });
  const first = await http.get('https://nafezly.com/projects');
  assert.equal(first.status, 429);
  const before = calls.length;
  await assert.rejects(http.get('https://nafezly.com/projects'), HostCooldownError);
  assert.equal(calls.length, before, 'no request should be sent during cooldown');
  advance(121_000);
  const again = await http.get('https://nafezly.com/projects');
  assert.equal(again.status, 429); // still limited, but we were allowed to try again
});

test('unreadable robots.txt (5xx) makes the crawler skip rather than guess', async () => {
  const { http, calls } = harness('', 503);
  await assert.rejects(http.get('https://example.com/projects'), /robots\.txt .* could not be read/);
  assert.ok(!calls.some((c) => c.url.endsWith('/projects')));
});

test('missing robots.txt (404) means no restrictions', async () => {
  const { http } = harness('', 404);
  const res = await http.get('https://example.com/projects');
  assert.equal(res.status, 200);
});

test('a redirect onto a disallowed path is refused', async () => {
  let clock = 0;
  const fetchImpl = (async (input: string) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response(MOSTAQL, { status: 200 });
    if (url.endsWith('/projects')) return new Response(null, { status: 302, headers: { location: '/search?q=x' } });
    return new Response('ok');
  }) as unknown as typeof fetch;
  const http = createPoliteHttp({ fetchImpl, now: () => clock, sleep: async (ms) => { clock += ms; }, userAgent: 't', minGapMs: 0 });
  await assert.rejects(http.get('https://mostaql.com/projects'), RobotsDisallowedError);
});
