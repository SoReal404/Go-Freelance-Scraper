import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';
import { http, SCRAPER_USER_AGENT } from '../net/polite-http.ts';

export const FREELANCER_API_BASE = 'https://www.freelancer.com/api/projects/0.1/projects';

export interface FreelancerApiResponse {
  status: string;
  result?: {
    projects?: FreelancerApiProject[];
  };
  message?: string;
}

export interface FreelancerApiProject {
  id: number;
  title: string;
  description?: string | null;
  preview_description?: string | null;
  seo_url?: string | null;
  currency?: {
    code?: string;
    sign?: string;
    name?: string;
  } | null;
  budget?: {
    minimum?: number | null;
    maximum?: number | null;
    project_type?: string | null;
  } | null;
  type?: string | null;
  jobs?: Array<{
    id: number;
    name: string;
    category?: { id: number; name: string } | null;
  }> | null;
  submitdate?: number | null;
  time_submitted?: number | null;
  time_updated?: number | null;
}

export function parseFreelancerProject(project: FreelancerApiProject): NormalizedProject {
  const externalId = String(project.id);
  const title = (project.title || '').replace(/\s+/g, ' ').trim();
  const fullDesc = (project.description || '').trim();
  const previewDesc = (project.preview_description || '').trim();
  const description = fullDesc || previewDesc;
  const listingDescription = previewDesc || fullDesc.slice(0, 200);

  const seo = project.seo_url?.replace(/^\/+/, '') || '';
  const url = seo.startsWith('http')
    ? seo
    : seo
      ? `https://www.freelancer.com/projects/${seo}`
      : `https://www.freelancer.com/projects/${externalId}`;

  const skills = Array.isArray(project.jobs)
    ? [...new Set(project.jobs.map((j) => (j.name || '').trim()).filter(Boolean))]
    : [];

  // Prefer time_updated (when the project went publicly active) over submitdate/time_submitted
  // (when the client first submitted the form — before Freelancer review, often 12h earlier).
  const rawTime = project.time_updated ?? project.submitdate ?? project.time_submitted;
  const postedAt = rawTime
    ? new Date(rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime)
    : new Date();

  const min = project.budget?.minimum;
  const max = project.budget?.maximum;
  const budgetType = project.type === 'hourly' ? 'hourly' : 'fixed';

  return {
    platform: 'freelancer',
    externalId,
    title,
    description,
    listingDescription,
    url,
    budgetMin: min != null && Number.isFinite(min) ? min : undefined,
    budgetMax: max != null && Number.isFinite(max) ? max : undefined,
    currency: project.currency?.code || undefined,
    budgetType,
    skills,
    language: 'en',
    postedAt,
    detailsEnriched: Boolean(fullDesc && skills.length > 0),
    raw: project,
  };
}

export async function fetchFreelancerActiveProjects(
  token = process.env.FREELANCER_OAUTH_TOKEN ?? '',
  limit = 50,
): Promise<{ status: number; projects: NormalizedProject[]; rawCount: number }> {
  const url = `${FREELANCER_API_BASE}/active/?limit=${limit}&full_description=true&job_details=true&sort_field=time_updated&sort_direction=desc`;

  const response = await http.get(url, {
    accept: 'application/json',
    headers: { 'Freelancer-OAuth-V1': token, 'User-Agent': SCRAPER_USER_AGENT },
    timeoutMs: 20_000,
    skipRobots: true, // official authenticated API, not a crawled page
  });

  if (!response.ok) {
    return { status: response.status, projects: [], rawCount: 0 };
  }

  const data = (await response.json()) as FreelancerApiResponse;
  const apiProjects = data.result?.projects || [];
  const normalized = apiProjects.map(parseFreelancerProject);

  return {
    status: response.status,
    projects: normalized,
    rawCount: apiProjects.length,
  };
}

export function createFreelancerAdapter(
  getToken = () => process.env.FREELANCER_OAUTH_TOKEN ?? '',
): PlatformAdapter {
  const tracker = createNewListingTracker();

  return {
    id: 'freelancer',
    name: 'Freelancer.com',
    region: 'international',
    pollIntervalMs: 60_000,

    async fetchNewProjects(since: Date): Promise<NormalizedProject[]> {
      const token = getToken();
      if (!token) {
        throw new Error('FREELANCER_OAUTH_TOKEN is required for Freelancer.com adapter.');
      }

      const { status, projects, rawCount } = await fetchFreelancerActiveProjects(token, 50);
      if (status === 429) {
        throw new Error('Freelancer.com API rate limit reached (HTTP 429).');
      }
      if (status === 401 || status === 403) {
        throw new Error(`Freelancer.com authentication failed (HTTP ${status}). Check FREELANCER_OAUTH_TOKEN.`);
      }
      if (status < 200 || status >= 300) {
        throw new Error(`Freelancer.com API returned HTTP ${status}.`);
      }
      if (rawCount === 0) {
        return [];
      }

      return tracker(projects, since);
    },

    async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
      try {
        const token = getToken();
        if (!token) {
          return { ok: false, detail: 'No FREELANCER_OAUTH_TOKEN provided' };
        }
        const { status, rawCount } = await fetchFreelancerActiveProjects(token, 1);
        if (status === 200) {
          return { ok: true, detail: `API connected; active feed returned ${rawCount} sample project` };
        }
        return { ok: false, detail: `HTTP ${status}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  };
}

export const freelancerAdapter = createFreelancerAdapter();
