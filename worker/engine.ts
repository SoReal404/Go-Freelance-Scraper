import type { PlatformAdapter, NormalizedProject } from './adapters/types.ts';
import { allAdapters, getAdapter, getAdaptersByRegion } from './adapters/index.ts';
import { enrichProjectDetails } from './enricher/detail-enricher.ts';
import { ProjectStore, defaultStore } from './storage/project-store.ts';

export interface ScraperEngineOptions {
  adapters?: PlatformAdapter[];
  store?: ProjectStore;
  enrichDetails?: boolean;
  minPacingGapMs?: number;
  maxPacingGapMs?: number;
  onNewProject?: (project: NormalizedProject) => void | Promise<void>;
  onLog?: (event: Record<string, unknown>) => void;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ScraperEngine {
  private adapters: PlatformAdapter[];
  private store: ProjectStore;
  private enrichDetails: boolean;
  private minPacingGapMs: number;
  private maxPacingGapMs: number;
  private onNewProject?: (project: NormalizedProject) => void | Promise<void>;
  private onLog: (event: Record<string, unknown>) => void;
  private isRunning = false;
  private lastRequestTimes = new Map<string, number>();

  constructor(options: ScraperEngineOptions = {}) {
    this.adapters = options.adapters || allAdapters;
    this.store = options.store || defaultStore;
    this.enrichDetails = options.enrichDetails ?? true;
    this.minPacingGapMs = options.minPacingGapMs ?? 3000;
    this.maxPacingGapMs = options.maxPacingGapMs ?? 6000;
    this.onNewProject = options.onNewProject;
    this.onLog = options.onLog || ((ev) => console.log(JSON.stringify(ev)));
  }

  private async paceRequest(adapterId: string): Promise<void> {
    const lastTime = this.lastRequestTimes.get(adapterId);
    if (lastTime) {
      const targetGap = this.minPacingGapMs + Math.random() * (this.maxPacingGapMs - this.minPacingGapMs);
      const remaining = lastTime + targetGap - Date.now();
      if (remaining > 0) {
        await pause(remaining);
      }
    }
    this.lastRequestTimes.set(adapterId, Date.now());
  }

  /**
   * Runs a single polling pass across all configured adapters.
   * Discovers new projects, enriches them with full details, and saves them to the store.
   */
  async runSingleCycle(): Promise<{
    polledAdapters: number;
    newProjectsFound: number;
    enrichedCount: number;
    errors: Array<{ platform: string; error: string }>;
  }> {
    await this.store.init();
    let newProjectsFound = 0;
    let enrichedCount = 0;
    const errors: Array<{ platform: string; error: string }> = [];

    for (const adapter of this.adapters) {
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

        for (let project of projects) {
          const isNew = !this.store.has(project.platform, project.externalId);
          if (isNew) {
            newProjectsFound += 1;
            this.onLog({
              event: 'new_project_detected',
              platform: project.platform,
              external_id: project.externalId,
              title: project.title,
              url: project.url,
            });

            // Enrich with full description, skills, and budget if requested
            if (this.enrichDetails && !project.detailsEnriched) {
              await this.paceRequest(adapter.id);
              project = await enrichProjectDetails(project);
              if (project.detailsEnriched) {
                enrichedCount += 1;
              }
            }

            await this.store.upsert(project);

            if (this.onNewProject) {
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
      polledAdapters: this.adapters.length,
      newProjectsFound,
      enrichedCount,
      errors,
    };
  }

  /**
   * Starts a continuous monitoring loop with jittered polling per adapter.
   */
  async startMonitoring(stopSignal?: AbortSignal): Promise<void> {
    this.isRunning = true;
    this.onLog({
      event: 'engine_started',
      adapters: this.adapters.map((a) => a.id),
      enrich_details: this.enrichDetails,
      at: new Date().toISOString(),
    });

    while (this.isRunning && !stopSignal?.aborted) {
      await this.runSingleCycle();
      // Wait between full cycles
      await pause(15_000);
    }

    this.onLog({ event: 'engine_stopped', at: new Date().toISOString() });
  }

  stop(): void {
    this.isRunning = false;
  }
}
