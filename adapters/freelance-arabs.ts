import { load } from 'cheerio';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';
import { http, SCRAPER_USER_AGENT, SCRAPE_POLL_INTERVAL_MS } from '../net/polite-http.ts';

export const FREELANCE_ARABS_LISTING_URL = 'https://arabsfreelancer.com/projects/';
export const FREELANCE_ARABS_USER_AGENT = SCRAPER_USER_AGENT;

export interface FreelanceArabsParseResult {
  projects: NormalizedProject[];
  rowCount: number;
  parseErrors: number;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

const arabicMonths: Record<string, number> = {
  يناير: 0, فبراير: 1, مارس: 2, أبريل: 3, ابريل: 3, مايو: 4, يونيو: 5,
  يوليو: 6, أغسطس: 7, اغسطس: 7, سبتمبر: 8, أكتوبر: 9, اكتوبر: 9,
  نوفمبر: 10, ديسمبر: 11,
};

export function parseFreelanceArabsDate(value: string): Date | undefined {
  const normalized = normalizeDigits(value).replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^([\p{L}]+)\s+(\d{1,2}),\s*(\d{4})$/u);
  if (!match) return undefined;
  const month = arabicMonths[match[1]];
  if (month === undefined) return undefined;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return date;
}

export function parseFreelanceArabsProjects(html: string): FreelanceArabsParseResult {
  const $ = load(html);
  const cards = $('div.projects[class*="post-"]').toArray();
  const projects: NormalizedProject[] = [];
  let parseErrors = 0;

  for (const node of cards) {
    const card = $(node);
    const link = card.find('.fr-latest-content h3 a').first();
    const url = link.attr('href');
    const externalId = card.attr('class')?.match(/(?:^|\s)post-(\d+)(?:\s|$)/)?.[1];
    const title = clean(link.text());
    const description = clean(card.find('.fr-latest-container p').first().text());
    const postedAt = parseFreelanceArabsDate(card.find('.fr-latest-profile').eq(1).text());

    if (!title || !url || !externalId || !postedAt) {
      parseErrors += 1;
      continue;
    }

    projects.push({
      platform: 'freelance-arabs',
      externalId,
      title,
      description,
      url,
      // The public archive includes excerpt and date, but not readable budget or skills.
      skills: [],
      language: 'ar',
      postedAt,
    });
  }
  return { projects, rowCount: cards.length, parseErrors };
}

export async function fetchFreelanceArabsHtml(): Promise<{ status: number; url: string; html: string }> {
  const response = await http.get(FREELANCE_ARABS_LISTING_URL, { timeoutMs: 20_000 });
  return { status: response.status, url: response.url, html: await response.text() };
}

const challengePattern = /cf-challenge|cf-chl-|cf_chl_opt|challenge-form|hcaptcha-challenge|verify you are human|just a moment|access denied/i;
const trackNewListings = createNewListingTracker();

export const freelanceArabsAdapter: PlatformAdapter = {
  id: 'freelance-arabs',
  name: 'FreelanceArabs',
  region: 'middle-east',
  pollIntervalMs: SCRAPE_POLL_INTERVAL_MS,
  async fetchNewProjects(since) {
    const response = await fetchFreelanceArabsHtml();
    if (response.status === 403 || response.status === 429 || challengePattern.test(response.html)) {
      throw new Error(`FreelanceArabs blocked the public listing request (HTTP ${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`FreelanceArabs listing returned HTTP ${response.status}.`);
    const parsed = parseFreelanceArabsProjects(response.html);
    if (!parsed.rowCount) throw new Error('FreelanceArabs project-card selector returned no rows.');
    return trackNewListings(parsed.projects, since);
  },
  async healthCheck() {
    try {
      const response = await fetchFreelanceArabsHtml();
      if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };
      if (challengePattern.test(response.html)) return { ok: false, detail: 'Challenge page returned' };
      const parsed = parseFreelanceArabsProjects(response.html);
      return parsed.rowCount && !parsed.parseErrors
        ? { ok: true, detail: `${parsed.rowCount} project archive entries; 0 parse errors` }
        : { ok: false, detail: `${parsed.rowCount} project archive entries; ${parsed.parseErrors} parse errors` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown request error' };
    }
  },
};
