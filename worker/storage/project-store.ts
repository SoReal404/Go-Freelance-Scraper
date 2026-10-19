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

export function fromStoredProject(p: StoredProject): NormalizedProject {
  return {
    platform: p.platform,
    externalId: p.external_id,
    title: p.title,
    description: p.description,
    listingDescription: p.listing_description,
    url: p.project_url,
    budgetMin: p.budget?.min ?? undefined,
    budgetMax: p.budget?.max ?? undefined,
    currency: p.budget?.currency ?? undefined,
    budgetType: p.budget?.type ?? undefined,
    skills: p.skills ?? [],
    category: p.category ?? undefined,
    subCategory: p.sub_category ?? undefined,
    language: p.language ?? undefined,
    postedAt: new Date(p.posted_at),
    firstSeenAt: new Date(p.first_seen_at),
    detailsEnriched: p.details_enriched,
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
    const [result] = await this.upsertMany([project]);
    return result;
  }

  /**
   * Writes a whole batch with ONE read-modify-write of the JSON file (it used to rewrite the entire
   * file once per project, which gets slow as the file grows).
   */
  async upsertMany(batch: NormalizedProject[]): Promise<Array<{ inserted: boolean; project: StoredProject }>> {
    if (batch.length === 0) return [];
    await this.init();
    await mkdir(dirname(this.filePath), { recursive: true });

    const lockPath = `${this.filePath}.lock`;
    const lock = await acquireLock(lockPath);
    let tempPath: string | undefined;

    try {
      const projects = await this.readAll();
      const index = new Map<string, number>();
      projects.forEach((p, i) => index.set(`${p.platform}\0${p.external_id}`, i));

      const results: Array<{ inserted: boolean; project: StoredProject }> = [];
      const fresh: StoredProject[] = [];

      for (const project of batch) {
        const stored = toStoredProject(project);
        const key = `${stored.platform}\0${stored.external_id}`;
        const at = index.get(key);

        if (at === undefined) {
          index.set(key, -1); // seen within this batch
          fresh.push(stored);
          results.push({ inserted: true, project: stored });
        } else if (at === -1) {
          const dup = fresh.findIndex((p) => `${p.platform}\0${p.external_id}` === key);
          fresh[dup] = { ...fresh[dup], ...stored, first_seen_at: fresh[dup].first_seen_at };
          results.push({ inserted: false, project: fresh[dup] });
        } else {
          projects[at] = {
            ...projects[at],
            ...stored,
            first_seen_at: projects[at].first_seen_at || stored.first_seen_at,
            details_enriched: stored.details_enriched || projects[at].details_enriched,
          };
          results.push({ inserted: false, project: projects[at] });
        }
      }

      const merged = [...fresh, ...projects];
      merged.sort((a, b) => b.posted_at.localeCompare(a.posted_at));

      const doc: StoredProjectDocument = {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        total_projects: merged.length,
        projects: merged,
      };

      tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(doc)}\n`, 'utf8'); // compact: ~35% smaller than pretty-printed
      await rename(tempPath, this.filePath);
      tempPath = undefined;

      for (const r of results) this.seenKeys.add(`${r.project.platform}\0${r.project.external_id}`);
      return results;
    } finally {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  /**
   * Remove projects older than `maxAgeDays` (based on posted_at, falling back to first_seen_at).
   * Rewrites the JSON file if any projects were pruned.
   */
  async pruneOlderThan(maxAgeDays = 3): Promise<number> {
    await this.init();
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const lock = await acquireLock(lockPath);
    let tempPath: string | undefined;

    try {
      const projects = await this.readAll();
      const kept: StoredProject[] = [];
      let removedCount = 0;

      for (const p of projects) {
        const time = new Date(p.posted_at || p.first_seen_at).getTime();
        if (isNaN(time) || time >= cutoffMs) {
          kept.push(p);
        } else {
          removedCount++;
          this.seenKeys.delete(`${p.platform}\0${p.external_id}`);
        }
      }

      if (removedCount > 0) {
        const doc: StoredProjectDocument = {
          schema_version: 1,
          updated_at: new Date().toISOString(),
          total_projects: kept.length,
          projects: kept,
        };
        tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(doc)}\n`, 'utf8');
        await rename(tempPath, this.filePath);
        tempPath = undefined;
      }

      return removedCount;
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
