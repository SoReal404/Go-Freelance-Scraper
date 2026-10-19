import type { PlatformAdapter, NormalizedProject } from './adapters/types.ts';
import { allAdapters } from './adapters/index.ts';
import { enrichProjectDetails } from './enricher/detail-enricher.ts';
import { ProjectStore, defaultStore } from './storage/project-store.ts';
import { upsertProjectsBatch, deleteProjectsOlderThan } from './storage/supabase-store.ts';

export interface ScraperEngineOptions {
  adapters?: PlatformAdapter[];
  store?: ProjectStore;
  enrichDetails?: boolean;
  minPacingGapMs?: number;
  maxPacingGapMs?: number;
  /** How often the watch loop wakes up to see which adapters are due. */
  tickMs?: number;
  /** Test hook: replaces the Supabase batch upsert. */
  syncProjects?: typeof upsertProjectsBatch;
  /** Test hook: replaces the Supabase delete. */
  deleteOldProjects?: typeof deleteProjectsOlderThan;
  /** Maximum age in days before projects are deleted from DB and local store (default: 3). */
  maxProjectAgeDays?: number;
  /** How often to run the cleanup job in watch mode (default: 1 hour). */
  cleanupIntervalMs?: number;
  onNewProject?: (project: NormalizedProject) => void | Promise<void>;
  onLog?: (event: Record<string, unknown>) => void;
}

const MAX_PENDING_SYNC = 5_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sleep that ends early when the signal aborts, so Ctrl+C / SIGTERM does not wait out the delay. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export class ScraperEngine {
  private adapters: PlatformAdapter[];
  private store: ProjectStore;
  private enrichDetails: boolean;
  private minPacingGapMs: number;
  private maxPacingGapMs: number;
  private tickMs: number;
  private syncProjects: typeof upsertProjectsBatch;
  private deleteOldProjects: typeof deleteProjectsOlderThan;
  private maxProjectAgeDays: number;
  private cleanupIntervalMs: number;
  private lastCleanupAt = 0;
  private onNewProject?: (project: NormalizedProject) => void | Promise<void>;
  private onLog: (event: Record<string, unknown>) => void;
  private isRunning = false;
  private wake = new AbortController();
  private lastRequestTimes = new Map<string, number>();
  private nextPollAt = new Map<string, number>();
  /** Projects saved locally whose Supabase upsert failed. Retried every cycle. */
  private pendingSync = new Map<string, NormalizedProject>();

  constructor(options: ScraperEngineOptions = {}) {
    this.adapters = options.adapters || allAdapters;
    this.store = options.store || defaultStore;
    this.enrichDetails = options.enrichDetails ?? true;
    this.minPacingGapMs = options.minPacingGapMs ?? 5_000; // min gap between starting different platforms
    this.maxPacingGapMs = options.maxPacingGapMs ?? 10_000;
    this.tickMs = options.tickMs ?? 15_000;
    this.syncProjects = options.syncProjects ?? upsertProjectsBatch;
    this.deleteOldProjects = options.deleteOldProjects ?? deleteProjectsOlderThan;
    this.maxProjectAgeDays = options.maxProjectAgeDays ?? 3;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1000;
    this.onNewProject = options.onNewProject;
    this.onLog = options.onLog || ((ev) => console.log(JSON.stringify(ev)));
  }

  private async paceRequest(adapterId: string): Promise<void> {
    const lastTime = this.lastRequestTimes.get(adapterId);
    if (lastTime) {
      const targetGap = this.minPacingGapMs + Math.random() * (this.maxPacingGapMs - this.minPacingGapMs);
      const remaining = lastTime + targetGap - Date.now();
      if (remaining > 0) await pause(remaining);
    }
    this.lastRequestTimes.set(adapterId, Date.now());
  }

  get pendingSyncCount(): number {
    return this.pendingSync.size;
  }

  private queueForSync(projects: NormalizedProject[]): void {
    for (const p of projects) {
      if (this.pendingSync.size >= MAX_PENDING_SYNC) break;
      this.pendingSync.set(`${p.platform}:${p.externalId}`, p);
    }
  }

  /** Push projects to Supabase; anything that fails stays queued for the next cycle. */
  private async syncToSupabase(projects: NormalizedProject[]): Promise<void> {
    if (projects.length === 0) return;
    const result = await this.syncProjects(projects);
    if (result.skipped > 0) return; // Supabase not configured: local JSON only
    for (const p of projects) this.pendingSync.delete(`${p.platform}:${p.externalId}`);
    if (result.failedProjects.length > 0) {
      this.queueForSync(result.failedProjects);
      this.onLog({
        event: 'supabase_sync_failed',
        failed: result.failedProjects.length,
        pending: this.pendingSync.size,
        at: new Date().toISOString(),
      });
    }
  }

  private async retryPendingSync(): Promise<void> {
    if (this.pendingSync.size === 0) return;
    const batch = [...this.pendingSync.values()];
    await this.syncToSupabase(batch);
    this.onLog({
      event: 'supabase_sync_retry',
      attempted: batch.length,
      still_pending: this.pendingSync.size,
      at: new Date().toISOString(),
    });
  }

  /**
   * Cleans up projects older than maxProjectAgeDays from both Supabase and local store.
   * Runs at most once every cleanupIntervalMs.
   */
  async runCleanupIfDue(): Promise<{ supabaseDeleted: number; localPruned: number }> {
    const now = Date.now();
    if (now - this.lastCleanupAt < this.cleanupIntervalMs) {
      return { supabaseDeleted: 0, localPruned: 0 };
    }
    this.lastCleanupAt = now;

    let supabaseDeleted = 0;
    let localPruned = 0;

    try {
      const dbResult = await this.deleteOldProjects(this.maxProjectAgeDays);
      supabaseDeleted = dbResult.deleted;
    } catch (err: any) {
      this.onLog({
        event: 'cleanup_supabase_error',
        error: err?.message || String(err),
        at: new Date().toISOString(),
      });
    }

    try {
      localPruned = await this.store.pruneOlderThan(this.maxProjectAgeDays);
    } catch (err: any) {
      this.onLog({
        event: 'cleanup_local_error',
        error: err?.message || String(err),
        at: new Date().toISOString(),
      });
    }

    if (supabaseDeleted > 0 || localPruned > 0) {
      this.onLog({
        event: 'cleanup_completed',
        max_age_days: this.maxProjectAgeDays,
        supabase_deleted: supabaseDeleted,
        local_pruned: localPruned,
        at: new Date().toISOString(),
      });
    }

    return { supabaseDeleted, localPruned };
  }

  /**
   * Runs a single polling pass across the given adapters (default: all).
   * Discovers new projects, enriches them with full details, and saves them to the store.
   */
  async runSingleCycle(adapters: PlatformAdapter[] = this.adapters): Promise<{
    polledAdapters: number;
    newProjectsFound: number;
    enrichedCount: number;
    errors: Array<{ platform: string; error: string }>;
  }> {
    await this.store.init();
    await this.runCleanupIfDue();
    await this.retryPendingSync();

    let newProjectsFound = 0;
    let enrichedCount = 0;
    const errors: Array<{ platform: string; error: string }> = [];

    for (const adapter of adapters) {
      try {
        await this.paceRequest(adapter.id);
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h window
        const projects = await adapter.fetchNewProjects(since);

        this.onLog({
          event: 'poll_success',
          platform: adapter.id,
          name: adapter.name,
          region: adapter.region,
          projects_fetched: projects.length,
          at: new Date().toISOString(),
        });

        const toSave: NormalizedProject[] = [];

        for (let project of projects) {
          if (this.store.has(project.platform, project.externalId)) continue;

          newProjectsFound += 1;
          this.onLog({
            event: 'new_project_detected',
            platform: project.platform,
            external_id: project.externalId,
            title: project.title,
            url: project.url,
          });

          // Detail-page fetches go through the polite HTTP client, which enforces robots.txt,
          // the per-host minimum gap, and backoff after 403/429/503.
          if (this.enrichDetails && !project.detailsEnriched) {
            project = await enrichProjectDetails(project);
            if (project.detailsEnriched) enrichedCount += 1;
          }
          toSave.push(project);
        }

        if (toSave.length > 0) {
          // One file rewrite per adapter instead of one per project.
          await this.store.upsertMany(toSave);
          await this.syncToSupabase(toSave);

          if (this.onNewProject) {
            for (const project of toSave) {
              try {
                await this.onNewProject(project);
              } catch (callbackErr: any) {
                this.onLog({
                  event: 'callback_error',
                  platform: project.platform,
                  error: callbackErr.message,
                });
              }
            }
          }
        }
      } catch (err: any) {
        const errorMsg = err?.message || 'Unknown polling error';
        errors.push({ platform: adapter.id, error: errorMsg });
        this.onLog({
          event: 'poll_error',
          platform: adapter.id,
          name: adapter.name,
          error: errorMsg,
          at: new Date().toISOString(),
        });
      }
    }

    return {
      polledAdapters: adapters.length,
      newProjectsFound,
      enrichedCount,
      errors,
    };
  }

  /**
   * Continuous monitoring. Each adapter is polled on its own interval (pollIntervalMs, with +/-10%
   * jitter); the loop just wakes up every tickMs to see which adapters are due.
   */
  async startMonitoring(stopSignal?: AbortSignal): Promise<void> {
    this.isRunning = true;
    this.wake = new AbortController();
    stopSignal?.addEventListener('abort', () => this.wake.abort(), { once: true });

    this.onLog({
      event: 'engine_started',
      adapters: this.adapters.map((a) => ({ id: a.id, every_seconds: Math.round(a.pollIntervalMs / 1000) })),
      enrich_details: this.enrichDetails,
      at: new Date().toISOString(),
    });

    while (this.isRunning && !this.wake.signal.aborted) {
      const now = Date.now();
      const due = this.adapters.filter((a) => (this.nextPollAt.get(a.id) ?? 0) <= now);

      if (due.length > 0) {
        await this.runSingleCycle(due);
        for (const a of due) {
          const jitter = 0.9 + Math.random() * 0.2;
          this.nextPollAt.set(a.id, Date.now() + a.pollIntervalMs * jitter);
        }
      }
      await abortableSleep(this.tickMs, this.wake.signal);
    }

    this.onLog({ event: 'engine_stopped', at: new Date().toISOString() });
  }

  stop(): void {
    this.isRunning = false;
    this.wake.abort();
  }
}
