import { load } from 'cheerio';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';

export const NAFEZLY_LISTING_URL = 'https://nafezly.com/projects';
export const NAFEZLY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface NafezlyParseResult {
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

export function parseNafezlyRelativeTime(value: string, seenAt = new Date()): Date | undefined {
  const normalized = normalizeDigits(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar');
  let amount: number | undefined;
  let milliseconds: number | undefined;

  if (/منذ\s+لحظات|منذ\s+الآن/.test(normalized)) { amount = 0; milliseconds = 60_000; }
  else if (/منذ\s+ثوان/.test(normalized)) { amount = 0; milliseconds = 1_000; }
  else if (/منذ\s+دقيقتين/.test(normalized)) { amount = 2; milliseconds = 60_000; }
  else if (/منذ\s+دقيقة/.test(normalized)) { amount = 1; milliseconds = 60_000; }
  else if (/منذ\s+ساعة/.test(normalized)) { amount = 1; milliseconds = 3_600_000; }
  else if (/منذ\s+ساعتين/.test(normalized)) { amount = 2; milliseconds = 3_600_000; }
  else if (/منذ\s+يومين/.test(normalized)) { amount = 2; milliseconds = 86_400_000; }
  else {
    const match = normalized.match(/منذ\s+(\d+)\s+(دقائق?|دقيقة|ساعات?|ساعة|أيام?|يوم)/);
    if (match) {
      amount = Number(match[1]);
      milliseconds = /دقيق/.test(match[2]) ? 60_000 : /ساع/.test(match[2]) ? 3_600_000 : 86_400_000;
    }
  }
  if (amount === undefined || milliseconds === undefined) return undefined;
  return new Date(seenAt.getTime() - amount * milliseconds);
}

export interface ParsedBudget {
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
}

export function parseNafezlyBudget(value: string): ParsedBudget {
  const normalized = normalizeDigits(value).replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const currency = /\$|\bUSD\b/i.test(normalized) ? 'USD'
    : /ريال/.test(normalized) ? 'SAR'
      : /جنيه/.test(normalized) ? 'EGP' : undefined;
  if (!currency) return {};
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|إلى)\s*(\d+(?:\.\d+)?)/);
  if (!range) {
    const single = normalized.match(/\d+(?:\.\d+)?/);
    if (!single) return {};
    const amount = Number(single[0]);
    return { budgetMin: amount, budgetMax: amount, currency };
  }
  return { budgetMin: Number(range[1]), budgetMax: Number(range[2]), currency };
}

export function parseNafezlyProjects(html: string, seenAt = new Date()): NafezlyParseResult {
  const $ = load(html);
  const cards = $('.project-box').toArray();
  const projects: NormalizedProject[] = [];
  let parseErrors = 0;

  for (const node of cards) {
    const card = $(node);
    const link = card.find('a.text-truncate[href*="/project/"]').not('[href*="create"]').first();
    const href = link.attr('href');
    const url = href ? new URL(href, 'https://nafezly.com').toString() : undefined;
    const externalId = url?.match(/\/project\/(\d+)(?:-|\/|$)/)?.[1];
    const title = clean(link.text());
    const description = clean(card.find('h3').first().text());
    const timeText = clean(card.find('.fa-clock').first().parent().text());
    const postedAt = parseNafezlyRelativeTime(timeText, seenAt);
    if (!title || !url || !externalId || !postedAt) {
      parseErrors += 1;
      continue;
    }

    const budget = parseNafezlyBudget(card.find('.fa-usd-circle').first().parent().text());
    projects.push({
      platform: 'nafezly',
      externalId,
      title,
      description,
      url,
      ...budget,
      // This public project list exposes budget and duration, but no named skill tags.
      skills: [],
      language: 'ar',
      postedAt,
    });
  }
  return { projects, rowCount: cards.length, parseErrors };
}

export async function fetchNafezlyHtml(): Promise<{ status: number; url: string; html: string }> {
  const response = await fetch(NAFEZLY_LISTING_URL, {
    headers: { 'User-Agent': NAFEZLY_USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, url: response.url, html: await response.text() };
}

const challengePattern = /cf-challenge|cf-chl-|cf_chl_opt|challenge-form|hcaptcha-challenge|verify you are human|just a moment|access denied/i;
const trackNewListings = createNewListingTracker();

export const nafezlyAdapter: PlatformAdapter = {
  id: 'nafezly',
  pollIntervalMs: 60_000,
  async fetchNewProjects(since) {
    const response = await fetchNafezlyHtml();
    if (response.status === 403 || response.status === 429 || challengePattern.test(response.html)) {
      throw new Error(`Nafezly blocked the public listing request (HTTP ${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Nafezly listing returned HTTP ${response.status}.`);
    const parsed = parseNafezlyProjects(response.html);
    if (!parsed.rowCount) throw new Error('Nafezly project-box selector returned no rows.');
    return trackNewListings(parsed.projects, since);
  },
  async healthCheck() {
    try {
      const response = await fetchNafezlyHtml();
      if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };
      if (challengePattern.test(response.html)) return { ok: false, detail: 'Challenge page returned' };
      const parsed = parseNafezlyProjects(response.html);
      return parsed.rowCount && !parsed.parseErrors
        ? { ok: true, detail: `${parsed.rowCount} project cards; 0 parse errors` }
        : { ok: false, detail: `${parsed.rowCount} project cards; ${parsed.parseErrors} parse errors` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown request error' };
    }
  },
};
