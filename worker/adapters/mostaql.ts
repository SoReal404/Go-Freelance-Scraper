import { load } from 'cheerio';
import type { NormalizedProject, PlatformAdapter } from './types.ts';

export const MOSTAQL_LISTING_URL = 'https://mostaql.com/projects?sort=latest';
export const MOSTAQL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface MostaqlParseResult {
  projects: NormalizedProject[];
  rowCount: number;
  parseErrors: number;
}

export function parseMostaqlRelativeTime(value: string, seenAt = new Date()): Date | undefined {
  const normalized = value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar');

  let amount: number | undefined;
  let unit: 'minute' | 'hour' | 'day' | undefined;

  const english = normalized.match(/(?:منذ\s*)?(\d+)\s*(minutes?|mins?|hours?|days?)\s*(?:ago)?/i);
  if (english) {
    amount = Number(english[1]);
    const unitText = english[2].toLowerCase();
    unit = unitText.startsWith('min') ? 'minute' : unitText.startsWith('hour') ? 'hour' : 'day';
  } else if (/منذ\s+لحظات|منذ\s+الآن/.test(normalized)) {
    amount = 0;
    unit = 'minute';
  } else if (/منذ\s+ثوان/.test(normalized)) {
    amount = 0;
    unit = 'minute';
  } else if (/منذ\s+دقيقة/.test(normalized)) {
    amount = 1;
    unit = 'minute';
  } else if (/منذ\s+ساعتين/.test(normalized)) {
    amount = 2;
    unit = 'hour';
  } else if (/منذ\s+يومين/.test(normalized)) {
    amount = 2;
    unit = 'day';
  } else {
    const arabic = normalized.match(/منذ\s+(\d+)\s+(دقائق?|دقيقة|ساعات?|ساعة|أيام?|يوم)/);
    if (arabic) {
      amount = Number(arabic[1]);
      const unitText = arabic[2];
      unit = /دقيق/.test(unitText) ? 'minute' : /ساع/.test(unitText) ? 'hour' : 'day';
    }
  }

  if (amount === undefined || unit === undefined || !Number.isFinite(amount)) return undefined;
  const milliseconds = unit === 'minute' ? 60_000 : unit === 'hour' ? 3_600_000 : 86_400_000;
  return new Date(seenAt.getTime() - amount * milliseconds);
}

function parseMostaqlDatetime(value: string | undefined, relativeText: string, seenAt: Date): Date | undefined {
  if (value) {
    // The listing's naive datetime is UTC: it agrees with the site's live
    // Arabic relative label when interpreted as UTC, not Cairo local time.
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
    const timestamp = new Date(normalized);
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }
  return parseMostaqlRelativeTime(relativeText, seenAt);
}

export function parseMostaqlProjects(html: string, seenAt = new Date()): MostaqlParseResult {
  const $ = load(html);
  const rows = $('tbody[data-filter="collection"] tr.project-row');
  const projects: NormalizedProject[] = [];
  let parseErrors = 0;

  rows.each((_index, row) => {
    const card = $(row);
    const link = card.find('.card--title h2 a[href*="/project/"]').first();
    const href = link.attr('href');
    const title = link.text().replace(/\s+/g, ' ').trim();
    const url = href ? new URL(href, 'https://mostaql.com').toString() : undefined;
    const externalId = url?.match(/\/project\/(\d+)(?:-|\/|$)/)?.[1];

    if (!title || !url || !externalId) {
      parseErrors += 1;
      return;
    }

    const time = card.find('time[itemprop="datePublished"]').first();
    const postedAt = parseMostaqlDatetime(
      time.attr('datetime'),
      time.text().replace(/\s+/g, ' ').trim(),
      seenAt,
    );
    if (!postedAt) {
      parseErrors += 1;
      return;
    }
    const description = card.find('p.project__brief').first().text().replace(/\s+/g, ' ').trim();

    projects.push({
      platform: 'mostaql',
      externalId,
      title,
      description,
      url,
      // Budget and skill tags are not shown in the observed listing rows.
      skills: [],
      language: 'ar',
      postedAt,
    });
  });

  return { projects, rowCount: rows.length, parseErrors };
}

export async function fetchMostaqlHtml(): Promise<{ status: number; url: string; html: string }> {
  const response = await fetch(MOSTAQL_LISTING_URL, {
    headers: {
      'User-Agent': MOSTAQL_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, url: response.url, html: await response.text() };
}

function isChallengePage(html: string): boolean {
  const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? '';
  return /verify you are human|just a moment|access denied|captcha/i.test(title) ||
    /challenge-platform|cf-challenge|cf-chl-|hcaptcha-challenge/i.test(html);
}

export function parseMostaqlBudgetFromText(text: string): { budgetMin?: number; budgetMax?: number; currency?: string } {
  const match = text.match(/\$?(\d+(?:\.\d+)?)\s*(?:-|–|إلى)\s*\$?(\d+(?:\.\d+)?)/);
  if (match) {
    return {
      budgetMin: Number(match[1]),
      budgetMax: Number(match[2]),
      currency: 'USD',
    };
  }
  const single = text.match(/\$?(\d+(?:\.\d+)?)/);
  if (single) {
    const val = Number(single[1]);
    return { budgetMin: val, budgetMax: val, currency: 'USD' };
  }
  return {};
}

export async function enrichMostaqlProjectDetail(project: NormalizedProject): Promise<NormalizedProject> {
  if (!project.url) return project;
  try {
    const response = await fetch(project.url, {
      headers: { 'User-Agent': MOSTAQL_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return project;

    const html = await response.text();
    const $ = load(html);

    // Full description
    const fullDesc = $('div.text-wrapper-div.carda__content, div.project__description')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Skills
    const skills = $('ul.skills__list li, .skills a, a[href*="/skills/"], .tag')
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter((s) => s && s.length > 1 && s.length < 50);
    const uniqueSkills = [...new Set([...project.skills, ...skills])];

    // Budget from project meta
    let budget = { budgetMin: project.budgetMin, budgetMax: project.budgetMax, currency: project.currency };
    const metaCardText = $('.carda__body, table.table--meta, dl.project__details').text().replace(/\s+/g, ' ').trim();
    const budgetMatch = metaCardText.match(/الميزانية\s*(\$?\d[\d.,\s–-]+\$?)/);
    if (budgetMatch) {
      const parsedBudget = parseMostaqlBudgetFromText(budgetMatch[1]);
      if (parsedBudget.budgetMin != null) {
        budget = { ...budget, ...parsedBudget };
      }
    }

    return {
      ...project,
      description: fullDesc && fullDesc.length >= project.description.length ? fullDesc : project.description,
      listingDescription: project.description,
      skills: uniqueSkills,
      ...budget,
      detailsEnriched: Boolean(fullDesc || uniqueSkills.length > 0),
    };
  } catch {
    return project;
  }
}

export const mostaqlAdapter: PlatformAdapter = {
  id: 'mostaql',
  name: 'Mostaql',
  region: 'middle-east',
  pollIntervalMs: 60_000,

  async fetchNewProjects(since: Date): Promise<NormalizedProject[]> {
    const response = await fetchMostaqlHtml();
    if (response.status === 403 || response.status === 429 || isChallengePage(response.html)) {
      throw new Error(`Mostaql blocked the public listing request (HTTP ${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Mostaql listing returned HTTP ${response.status}.`);
    }
    const parsed = parseMostaqlProjects(response.html);
    if (!parsed.rowCount) throw new Error('Mostaql project-row selector returned no rows.');
    return parsed.projects.filter((project) => project.postedAt >= since);
  },

  async enrichProject(project: NormalizedProject): Promise<NormalizedProject> {
    return enrichMostaqlProjectDetail(project);
  },

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await fetchMostaqlHtml();
      if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };
      if (isChallengePage(response.html)) return { ok: false, detail: 'Challenge page returned' };
      const parsed = parseMostaqlProjects(response.html);
      return parsed.rowCount > 0
        ? { ok: true, detail: `${parsed.rowCount} listing rows; ${parsed.parseErrors} parse errors` }
        : { ok: false, detail: 'Project-row selector found no listings' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown request error' };
    }
  },
};

