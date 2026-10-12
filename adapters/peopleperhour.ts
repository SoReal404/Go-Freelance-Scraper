import { load } from 'cheerio';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';
import { http, SCRAPER_USER_AGENT, SCRAPE_POLL_INTERVAL_MS } from '../net/polite-http.ts';

export const PPH_LISTING_URL = 'https://www.peopleperhour.com/freelance-jobs';
export const PPH_USER_AGENT = SCRAPER_USER_AGENT;

export interface PphRawProject {
  id: string;
  type?: string;
  attributes?: {
    proj_id?: number | string;
    title?: string;
    proj_desc?: string;
    budget?: number;
    currency?: string;
    project_type?: string;
    url?: string;
    category?: { cate_name?: string };
    sub_category?: { subcate_name?: string };
    posted_dt?: string;
    proposalCount?: number;
    client?: { country?: string; fname?: string };
  };
}

export function parsePphInitialState(html: string): PphRawProject[] {
  const prefix = 'window.PPHReact.initialState=';
  const start = html.indexOf(prefix);
  if (start === -1) return [];

  const jsonStart = start + prefix.length;
  const boundary = ';\n    window.PPHReact.';
  const end = html.indexOf(boundary, jsonStart);
  if (end === -1) return [];

  try {
    const jsonStr = html.slice(jsonStart, end);
    const state = JSON.parse(jsonStr);
    const projectsObj = state.entities?.projects || {};
    return Object.values(projectsObj) as PphRawProject[];
  } catch {
    return [];
  }
}

export function parsePphProject(raw: PphRawProject): NormalizedProject | undefined {
  const attrs = raw.attributes;
  if (!attrs) return undefined;

  const externalId = String(attrs.proj_id || raw.id);
  const title = (attrs.title || '').replace(/\s+/g, ' ').trim();
  const description = (attrs.proj_desc || '').replace(/\s+/g, ' ').trim();
  const url = attrs.url || `https://www.peopleperhour.com/freelance-jobs/${externalId}`;

  if (!externalId || !title) return undefined;

  const postedAt = attrs.posted_dt
    ? new Date(`${attrs.posted_dt.replace(' ', 'T')}Z`)
    : new Date();

  const skills: string[] = [];
  if (attrs.category?.cate_name) skills.push(attrs.category.cate_name);
  if (attrs.sub_category?.subcate_name) skills.push(attrs.sub_category.subcate_name);

  const budgetType = attrs.project_type?.toLowerCase() === 'hourly' ? 'hourly' : 'fixed';

  return {
    platform: 'peopleperhour',
    externalId,
    title,
    description,
    listingDescription: description,
    url,
    budgetMin: attrs.budget != null && Number.isFinite(attrs.budget) ? attrs.budget : undefined,
    budgetMax: attrs.budget != null && Number.isFinite(attrs.budget) ? attrs.budget : undefined,
    currency: attrs.currency,
    budgetType,
    skills,
    category: attrs.category?.cate_name,
    subCategory: attrs.sub_category?.subcate_name,
    language: 'en',
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    detailsEnriched: false,
    raw,
  };
}

export async function fetchPphHtml(): Promise<{ status: number; html: string }> {
  const response = await http.get(PPH_LISTING_URL, {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    timeoutMs: 20_000,
  });
  return { status: response.status, html: await response.text() };
}

export async function enrichPphProjectDetail(project: NormalizedProject): Promise<NormalizedProject> {
  if (!project.url) return project;
  try {
    const res = await http.get(project.url, { timeoutMs: 15_000 });
    if (!res.ok) return project;

    const html = await res.text();
    const $ = load(html);

    // Extract detailed text
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const articleText = $('article, .job-description, .proj-desc').text().replace(/\s+/g, ' ').trim();

    const candidates = [articleText, ogDesc, metaDesc, project.description].filter((t) => t && t.length > 20);
    candidates.sort((a, b) => b.length - a.length);
    const fullDescription = candidates[0] || project.description;

    // Extract skill badges
    const tags = $('a[href*="/freelance-"], .tag, .badge, [class*="skill"]')
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length > 1 && t.length < 50 && !/^\d+$/.test(t) && !/£|\$|Search/i.test(t));

    const combinedSkills = [...new Set([...project.skills, ...tags])];

    return {
      ...project,
      description: fullDescription,
      skills: combinedSkills,
      detailsEnriched: true,
    };
  } catch {
    return project;
  }
}

const trackNewListings = createNewListingTracker();

export const peoplePerHourAdapter: PlatformAdapter = {
  id: 'peopleperhour',
  name: 'PeoplePerHour',
  region: 'international',
  pollIntervalMs: SCRAPE_POLL_INTERVAL_MS,

  async fetchNewProjects(since: Date): Promise<NormalizedProject[]> {
    const { status, html } = await fetchPphHtml();
    if (status === 403 || status === 429) {
      throw new Error(`PeoplePerHour returned HTTP ${status}.`);
    }
    if (status < 200 || status >= 300) {
      throw new Error(`PeoplePerHour listing returned HTTP ${status}.`);
    }

    const rawList = parsePphInitialState(html);
    const projects: NormalizedProject[] = [];
    for (const raw of rawList) {
      const parsed = parsePphProject(raw);
      if (parsed) projects.push(parsed);
    }

    return trackNewListings(projects, since);
  },

  async enrichProject(project: NormalizedProject): Promise<NormalizedProject> {
    return enrichPphProjectDetail(project);
  },

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { status, html } = await fetchPphHtml();
      if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
      const rawList = parsePphInitialState(html);
      return rawList.length > 0
        ? { ok: true, detail: `State parsed successfully; ${rawList.length} project records found` }
        : { ok: false, detail: 'InitialState contained 0 project records' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
};
