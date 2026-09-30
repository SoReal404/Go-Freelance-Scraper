import { load } from 'cheerio';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';

export const GURU_LISTING_URL = 'https://www.guru.com/d/jobs/';
export const GURU_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface GuruParseResult {
  projects: NormalizedProject[];
  rowCount: number;
  parseErrors: number;
}

export function parseGuruBudget(text: string): {
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetType?: 'fixed' | 'hourly';
} {
  const clean = text.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const isHourly = /hourly|\/hr/i.test(clean);
  const currency = /\$|USD/i.test(clean)
    ? 'USD'
    : /£|GBP/i.test(clean)
      ? 'GBP'
      : /€|EUR/i.test(clean)
        ? 'EUR'
        : 'USD';

  const range = clean.match(/\$?(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?(\d+(?:\.\d+)?)/i);
  if (range) {
    return {
      budgetMin: Number(range[1]),
      budgetMax: Number(range[2]),
      currency,
      budgetType: isHourly ? 'hourly' : 'fixed',
    };
  }

  const single = clean.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    const val = Number(single[1]);
    return {
      budgetMin: val,
      budgetMax: val,
      currency,
      budgetType: isHourly ? 'hourly' : 'fixed',
    };
  }

  return { currency, budgetType: isHourly ? 'hourly' : 'fixed' };
}

export function parseGuruProjects(html: string, seenAt = new Date()): GuruParseResult {
  const $ = load(html);
  const projects: NormalizedProject[] = [];
  let parseErrors = 0;

  // Guru card selectors
  const cards = $('.record, .record__header, [data-testid="job-card"], .serviceItem').toArray();

  for (const el of cards) {
    const card = $(el);
    const titleLink = card.find('h2 a, .jobTitle a, .record__header__title a, a[href*="/d/jobs/"]').first();
    const title = titleLink.text().replace(/\s+/g, ' ').trim();
    const href = titleLink.attr('href');
    const url = href ? new URL(href, 'https://www.guru.com').toString() : undefined;
    const externalId = url?.match(/\/(\d+)(?:[/?#]|$)/)?.[1] || href || '';

    if (!title || !url || !externalId) {
      parseErrors += 1;
      continue;
    }

    const description = card
      .find('.record__desc, .jobDesc, p.desc, .serviceDesc')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const budgetText = card.find('.record__budget, .budget, .serviceBudget').first().text();
    const budget = parseGuruBudget(budgetText);

    const skills = card
      .find('.skills a, .record__skills a, .skillItem')
      .toArray()
      .map((s) => $(s).text().replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    projects.push({
      platform: 'guru',
      externalId,
      title,
      description,
      listingDescription: description,
      url,
      ...budget,
      skills,
      language: 'en',
      postedAt: seenAt,
      detailsEnriched: false,
    });
  }

  return {
    projects,
    rowCount: cards.length,
    parseErrors,
  };
}

export function isIncapsulaChallenge(html: string): boolean {
  return /_Incapsula_Resource|Incapsula incident ID|Request unsuccessful/i.test(html);
}

export async function fetchGuruHtml(): Promise<{ status: number; html: string; blocked: boolean }> {
  const cookie = process.env.GURU_COOKIE;
  const proxyUrl = process.env.GURU_PROXY_URL;
  const targetUrl = proxyUrl ? `${proxyUrl}?url=${encodeURIComponent(GURU_LISTING_URL)}` : GURU_LISTING_URL;

  const headers: Record<string, string> = {
    'User-Agent': GURU_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(targetUrl, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  const html = await response.text();
  const blocked = isIncapsulaChallenge(html) || response.status === 403;

  return { status: response.status, html, blocked };
}

export const guruAdapter: PlatformAdapter = {
  id: 'guru',
  name: 'Guru.com',
  region: 'international',
  pollIntervalMs: 60_000,

  async fetchNewProjects(since: Date): Promise<NormalizedProject[]> {
    const { status, html, blocked } = await fetchGuruHtml();
    if (blocked) {
      throw new Error(
        'Guru.com blocked the request with Imperva Incapsula WAF. Provide GURU_COOKIE or GURU_PROXY_URL (residential proxy) to bypass.',
      );
    }
    if (status < 200 || status >= 300) {
      throw new Error(`Guru.com listing returned HTTP ${status}.`);
    }

    const parsed = parseGuruProjects(html);
    const tracker = createNewListingTracker();
    return tracker(parsed.projects, since);
  },

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { status, html, blocked } = await fetchGuruHtml();
      if (blocked) {
        return {
          ok: false,
          detail: 'Protected by Imperva Incapsula WAF (requires GURU_COOKIE or residential proxy)',
        };
      }
      if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
      const parsed = parseGuruProjects(html);
      return parsed.rowCount > 0
        ? { ok: true, detail: `${parsed.rowCount} job records found` }
        : { ok: false, detail: 'No job cards matched DOM selectors' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
};
