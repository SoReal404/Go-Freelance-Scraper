import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { NormalizedProject, PlatformId } from '../adapters/types.ts';

export interface StoredProjectDocument {
  schema_version: number;
  updated_at: string;
  total_projects: number;
  projects: StoredProject[];
}

export interface StoredProject {
  platform: PlatformId;
  external_id: string;
  title: string;
  description: string;
  listing_description?: string;
  project_url: string;
  budget: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    type?: 'fixed' | 'hourly' | null;
  };
  skills: string[];
  category?: string | null;
  sub_category?: string | null;
  language?: string | null;
  posted_at: string;
  first_seen_at: string;
  details_enriched: boolean;
  last_updated_at: string;
}

const LOCK_WAIT_MS = 100;
const STALE_LOCK_MS = 60_000;

async function acquireLock(lockPath: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await open(lockPath, 'wx');
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError: any) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      await new Promise((done) => setTimeout(done, LOCK_WAIT_MS));
    }
  }
  throw new Error(`Timed out acquiring storage lock: ${lockPath}`);
}

export function toStoredProject(project: NormalizedProject, seenAt = new Date()): StoredProject {
  return {
    platform: project.platform,
    external_id: String(project.externalId),
    title: project.title,
    description: project.description,
    listing_description: project.listingDescription,
    project_url: project.url,
    budget: {
      min: project.budgetMin ?? null,
      max: project.budgetMax ?? null,
      currency: project.currency ?? null,
      type: project.budgetType ?? null,
    },
    skills: project.skills || [],
    category: project.category ?? null,
    sub_category: project.subCategory ?? null,
    language: project.language ?? null,
    posted_at: project.postedAt instanceof Date ? project.postedAt.toISOString() : String(project.postedAt),
    first_seen_at: (project.firstSeenAt || seenAt).toISOString(),
    details_enriched: Boolean(project.detailsEnriched),
    last_updated_at: new Date().toISOString(),
  };
}

export class ProjectStore {
  private filePath: string;
  private seenKeys = new Set<string>();
  private initialized = false;

  constructor(filePath = resolve('data/projects.json')) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const projects = await this.readAll();
    for (const p of projects) {
      this.seenKeys.add(`${p.platform}\0${p.external_id}`);
    }
    this.initialized = true;
  }

  has(platform: PlatformId, externalId: string): boolean {
    return this.seenKeys.has(`${platform}\0${String(externalId)}`);
  }

  async readAll(): Promise<StoredProject[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const doc = JSON.parse(content) as StoredProjectDocument;
      return Array.isArray(doc.projects) ? doc.projects : [];
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw new Error(`Could not read project store ${this.filePath}: ${error.message}`);
    }
  }

  async upsert(project: NormalizedProject): Promise<{ inserted: boolean; project: StoredProject }> {
    await this.init();
    await mkdir(dirname(this.filePath), { recursive: true });

    const lockPath = `${this.filePath}.lock`;
    const lock = await acquireLock(lockPath);
    let tempPath: string | undefined;

    try {
      const projects = await this.readAll();
      const stored = toStoredProject(project);

      const index = projects.findIndex(
        (p) => p.platform === stored.platform && p.external_id === stored.external_id,
      );

      const inserted = index === -1;
      if (inserted) {
        projects.unshift(stored);
      } else {
        projects[index] = {
          ...projects[index],
          ...stored,
          first_seen_at: projects[index].first_seen_at || stored.first_seen_at,
          details_enriched: stored.details_enriched || projects[index].details_enriched,
        };
      }

      // Sort by posted_at desc
      projects.sort((a, b) => b.posted_at.localeCompare(a.posted_at));

      const doc: StoredProjectDocument = {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        total_projects: projects.length,
        projects,
      };

      tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      await rename(tempPath, this.filePath);

      this.seenKeys.add(`${stored.platform}\0${stored.external_id}`);

      return {
        inserted,
        project: inserted ? stored : projects[index],
      };
    } finally {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  async getStats(): Promise<{
    total: number;
    byPlatform: Record<string, number>;
    enrichedCount: number;
  }> {
    const projects = await this.readAll();
    const byPlatform: Record<string, number> = {};
    let enrichedCount = 0;

    for (const p of projects) {
      byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1;
      if (p.details_enriched) enrichedCount += 1;
    }

    return {
      total: projects.length,
      byPlatform,
      enrichedCount,
    };
  }
}

export const defaultStore = new ProjectStore();
