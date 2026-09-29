/**
 * Temporary worker-local contracts. The initial workspace has no
 * packages/shared yet; move these definitions there when that package lands.
 */
export interface NormalizedProject {
  platform: string;
  externalId: string;
  title: string;
  description: string;
  url: string;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetType?: 'fixed' | 'hourly';
  skills: string[];
  language?: string;
  postedAt: Date;
  raw?: unknown;
}

export interface PlatformAdapter {
  id: 'freelancer' | 'upwork' | 'peopleperhour' | 'mostaql' | 'khamsat' |
    'shoghlonline' | 'nafezly' | 'freelance-arabs';
  pollIntervalMs: number;
  fetchNewProjects(since: Date): Promise<NormalizedProject[]>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
