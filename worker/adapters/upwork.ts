import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject, PlatformAdapter } from './types.ts';

export const UPWORK_GRAPHQL_ENDPOINT = 'https://api.upwork.com/graphql';

export interface UpworkGqlEdge {
  node: {
    id: string;
    title: string;
    description: string;
    category?: { name?: string };
    skills?: Array<{ name?: string }>;
    amount?: {
      amount?: number;
      currencyCode?: string;
    };
    createdDateTime?: string;
    publishedDateTime?: string;
    duration?: string;
    hourlyBudgetType?: string;
  };
}

export function parseUpworkNode(node: UpworkGqlEdge['node']): NormalizedProject {
  const externalId = node.id;
  const title = (node.title || '').replace(/\s+/g, ' ').trim();
  const description = (node.description || '').replace(/\s+/g, ' ').trim();
  const url = `https://www.upwork.com/jobs/${externalId}`;

  const skills = Array.isArray(node.skills)
    ? node.skills.map((s) => (s.name || '').trim()).filter(Boolean)
    : [];

  const rawDate = node.publishedDateTime || node.createdDateTime;
  const postedAt = rawDate ? new Date(rawDate) : new Date();

  const amount = node.amount?.amount;
  const currency = node.amount?.currencyCode || 'USD';

  return {
    platform: 'upwork',
    externalId,
    title,
    description,
    listingDescription: description.slice(0, 200),
    url,
    budgetMin: amount != null && Number.isFinite(amount) ? amount : undefined,
    budgetMax: amount != null && Number.isFinite(amount) ? amount : undefined,
    currency,
    budgetType: node.hourlyBudgetType ? 'hourly' : 'fixed',
    skills,
    category: node.category?.name,
    language: 'en',
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    detailsEnriched: true,
    raw: node,
  };
}

export const UPWORK_SEARCH_QUERY = `
query marketplaceJobPostingsSearch(
  $searchType: MarketplaceJobPostingSearchType,
  $sortAttributes: [MarketplaceJobPostingSearchSortAttribute]
) {
  marketplaceJobPostingsSearch(
    searchType: $searchType,
    sortAttributes: $sortAttributes
  ) {
    totalCount
    edges {
      node {
        id
        title
        description
        category {
          name
        }
        skills {
          name
        }
        amount {
          amount
          currencyCode
        }
        createdDateTime
        publishedDateTime
        duration
      }
    }
  }
}
`;

export async function fetchUpworkGraphQL(
  token = process.env.UPWORK_OAUTH_TOKEN || process.env.UPWORK_GQL_TOKEN,
): Promise<{ status: number; projects: NormalizedProject[]; rawCount: number }> {
  if (!token) {
    return { status: 401, projects: [], rawCount: 0 };
  }

  const response = await fetch(UPWORK_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify({
      query: UPWORK_SEARCH_QUERY,
      variables: {
        searchType: 'USER_JOBS_SEARCH',
        sortAttributes: [{ field: 'RECENCY' }],
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    return { status: response.status, projects: [], rawCount: 0 };
  }

  const data = (await response.json()) as {
    data?: {
      marketplaceJobPostingsSearch?: {
        edges?: UpworkGqlEdge[];
      };
    };
  };

  const edges = data.data?.marketplaceJobPostingsSearch?.edges || [];
  const projects = edges.map((e) => parseUpworkNode(e.node));

  return {
    status: response.status,
    projects,
    rawCount: edges.length,
  };
}

export function createUpworkAdapter(
  getToken = () => process.env.UPWORK_OAUTH_TOKEN || process.env.UPWORK_GQL_TOKEN,
): PlatformAdapter {
  const tracker = createNewListingTracker();

  return {
    id: 'upwork',
    name: 'Upwork',
    region: 'international',
    pollIntervalMs: 60_000,

    async fetchNewProjects(since: Date): Promise<NormalizedProject[]> {
      const token = getToken();
      if (!token) {
        throw new Error(
          'UPWORK_OAUTH_TOKEN or UPWORK_GQL_TOKEN is required. Upwork retired public RSS feeds in 2024 and protects endpoints with Cloudflare.',
        );
      }

      const { status, projects } = await fetchUpworkGraphQL(token);
      if (status === 401 || status === 403) {
        throw new Error(`Upwork authentication failed (HTTP ${status}). Check UPWORK_OAUTH_TOKEN.`);
      }
      if (status < 200 || status >= 300) {
        throw new Error(`Upwork API returned HTTP ${status}.`);
      }

      return tracker(projects, since);
    },

    async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
      const token = getToken();
      if (!token) {
        return {
          ok: false,
          detail: 'UPWORK_OAUTH_TOKEN / UPWORK_GQL_TOKEN not configured (required for Upwork GraphQL API)',
        };
      }
      try {
        const { status, rawCount } = await fetchUpworkGraphQL(token);
        if (status === 200) {
          return { ok: true, detail: `GraphQL API connected; ${rawCount} jobs returned` };
        }
        return { ok: false, detail: `HTTP ${status}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  };
}

export const upworkAdapter = createUpworkAdapter();
