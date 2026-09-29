import { load } from 'cheerio';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';

export const SHOGHLONLINE_LISTING_URL = 'https://shoghlonline.com/jobs';
export const SHOGHLONLINE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface ShoghlonlineParseResult {
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

export function parseShoghlonlineRelativeTime(value: string, seenAt = new Date()): Date | undefined {
  const normalized = normalizeDigits(value).replace(/\s+/g, ' ').trim();
  const lower = normalized.toLocaleLowerCase('ar');
  let amount: number;
  let unit: number;

  if (lower === 'أول أمس') { amount = 2; unit = 86_400_000; }
  else if (lower === 'الشهر الماضي') { amount = 30; unit = 86_400_000; }
  else if (/قبل\s+سنتين/.test(lower)) { amount = 2; unit = 365.25 * 86_400_000; }
  else {
    const match = lower.match(/قبل\s+(\d+)\s+(دقائق?|دقيقة|ساعات?|ساعة|أيام?|يوم|أسابيع?|أسبوع|شهور?|شهرًا|أشهر|سنوات?|سنة|عامًا|عام)/);
    if (!match) return undefined;
    amount = Number(match[1]);
    const unitText = match[2];
    if (/دقيق/.test(unitText)) unit = 60_000;
    else if (/ساع/.test(unitText)) unit = 3_600_000;
    else if (/يوم/.test(unitText)) unit = 86_400_000;
    else if (/أسبوع/.test(unitText)) unit = 7 * 86_400_000;
    else if (/شهر/.test(unitText) || /أشهر/.test(unitText)) unit = 30 * 86_400_000;
    else unit = 365.25 * 86_400_000;
  }
  return new Date(seenAt.getTime() - amount * unit);
}

export function parseShoghlonlineProjects(html: string, seenAt = new Date()): ShoghlonlineParseResult {
  const $ = load(html);
  const cards = $('main h2 a[href^="/jobs/"]').filter((_index, node) => clean($(node).text()).length > 0).toArray();
  const projects: NormalizedProject[] = [];
  let parseErrors = 0;

  for (const linkNode of cards) {
    const link = $(linkNode);
    const card = link.closest('div.flex.items-start.gap-4');
    const href = link.attr('href');
    const url = href ? new URL(href, 'https://shoghlonline.com').toString() : undefined;
    const externalId = url ? decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '') : '';
    const title = clean(link.text());
    const timeText = clean(card.find('h2').parent().find('.mt-1 span').first().text());
    const postedAt = parseShoghlonlineRelativeTime(timeText, seenAt);

    if (!title || !url || !externalId || !postedAt) {
      parseErrors += 1;
      continue;
    }

    projects.push({
      platform: 'shoghlonline',
      externalId,
      title,
      description: clean(card.find('p.mt-3').first().text()),
      url,
      // The live listing card has named skill tags but no visible budget.
      skills: card.find('div.mt-3.flex.flex-wrap').first().find('span').toArray().map((node) => clean($(node).text())).filter(Boolean),
      language: 'ar',
      postedAt,
    });
  }
  return { projects, rowCount: cards.length, parseErrors };
}

export async function fetchShoghlonlineHtml(): Promise<{ status: number; url: string; html: string }> {
  const response = await fetch(SHOGHLONLINE_LISTING_URL, {
    headers: { 'User-Agent': SHOGHLONLINE_USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, url: response.url, html: await response.text() };
}

const challengePattern = /cf-challenge|cf-chl-|cf_chl_opt|challenge-form|hcaptcha-challenge|verify you are human|just a moment|access denied/i;
const trackNewListings = createNewListingTracker();

export const shoghlonlineAdapter: PlatformAdapter = {
  id: 'shoghlonline',
  pollIntervalMs: 60_000,
  async fetchNewProjects(since) {
    const response = await fetchShoghlonlineHtml();
    if (response.status === 403 || response.status === 429 || challengePattern.test(response.html)) {
      throw new Error(`Shoghlonline blocked the public listing request (HTTP ${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Shoghlonline listing returned HTTP ${response.status}.`);
    const parsed = parseShoghlonlineProjects(response.html);
    if (!parsed.rowCount) throw new Error('Shoghlonline job-card selector returned no rows.');
    return trackNewListings(parsed.projects, since);
  },
  async healthCheck() {
    try {
      const response = await fetchShoghlonlineHtml();
      if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };
      if (challengePattern.test(response.html)) return { ok: false, detail: 'Challenge page returned' };
      const parsed = parseShoghlonlineProjects(response.html);
      return parsed.rowCount && !parsed.parseErrors
        ? { ok: true, detail: `${parsed.rowCount} listing cards; 0 parse errors` }
        : { ok: false, detail: `${parsed.rowCount} listing cards; ${parsed.parseErrors} parse errors` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown request error' };
    }
  },
};
