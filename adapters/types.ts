export type PlatformId =
  | 'freelancer'
  | 'peopleperhour'
  | 'mostaql'
  | 'khamsat'
  | 'shoghlonline'
  | 'nafezly'
  | 'freelance-arabs';

export type PlatformRegion = 'middle-east' | 'international';

export interface NormalizedProject {
  platform: PlatformId;
  externalId: string;
  title: string;
  description: string;
  listingDescription?: string;
  url: string;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetType?: 'fixed' | 'hourly';
  skills: string[];
  category?: string;
  subCategory?: string;
  language?: string;
  postedAt: Date;
  firstSeenAt?: Date;
  detailsEnriched?: boolean;
  raw?: unknown;
}

export interface PlatformAdapter {
  id: PlatformId;
  name: string;
  region: PlatformRegion;
  pollIntervalMs: number;
  fetchNewProjects(since: Date): Promise<NormalizedProject[]>;
  enrichProject?(project: NormalizedProject): Promise<NormalizedProject>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
