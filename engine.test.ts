import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScraperEngine } from './engine.ts';
import { ProjectStore } from './storage/project-store.ts';
import type { NormalizedProject, PlatformAdapter } from './adapters/types.ts';

const make = (id: string): NormalizedProject => ({
  platform: 'freelancer',
  externalId: id,
  title: `P${id}`,
  description: 'x'.repeat(150),
  url: `https://www.freelancer.com/projects/${id}`,
  skills: ['python'],
  postedAt: new Date(),
  detailsEnriched: true,
});

const adapterOf = (projects: NormalizedProject[]): PlatformAdapter => ({
  id: 'freelancer',
  name: 'Fake',
  region: 'international',
  pollIntervalMs: 60_000,
  fetchNewProjects: async () => projects,
  healthCheck: async () => ({ ok: true }),
});

async function setup(syncImpl: (p: NormalizedProject[]) => Promise<any>, projects: NormalizedProject[]) {
  const dir = await mkdtemp(join(tmpdir(), 'engine-'));
  const store = new ProjectStore(join(dir, 'projects.json'));
  const engine = new ScraperEngine({
    adapters: [adapterOf(projects)],
    store,
    minPacingGapMs: 0,
    maxPacingGapMs: 0,
    onLog: () => {},
    syncProjects: syncImpl as any,
  });
  return { engine, store };
}

test('a failed Supabase upsert is queued and retried on the next cycle instead of being lost', async () => {
  let failing = true;
  const sent: string[][] = [];
  const sync = async (batch: NormalizedProject[]) => {
    sent.push(batch.map((p) => p.externalId));
    return failing
      ? { ok: 0, failed: batch.length, skipped: 0, failedProjects: batch }
      : { ok: batch.length, failed: 0, skipped: 0, failedProjects: [] };
  };
  const { engine, store } = await setup(sync, [make('1'), make('2')]);

  await engine.runSingleCycle();
  assert.equal(store.has('freelancer', '1'), true, 'saved locally');
  assert.equal(engine.pendingSyncCount, 2, 'but still waiting for Supabase');

  failing = false;
  await engine.runSingleCycle(); // retry happens at the start of the cycle
  assert.equal(engine.pendingSyncCount, 0);
  assert.deepEqual(sent[1].sort(), ['1', '2']);
});

test('when Supabase is not configured nothing is queued', async () => {
  const sync = async (batch: NormalizedProject[]) => ({ ok: 0, failed: 0, skipped: batch.length, failedProjects: [] });
  const { engine } = await setup(sync, [make('1')]);
  await engine.runSingleCycle();
  assert.equal(engine.pendingSyncCount, 0);
});

test('already-stored projects are not synced or counted again', async () => {
  let calls = 0;
  const sync = async (batch: NormalizedProject[]) => { calls += 1; return { ok: batch.length, failed: 0, skipped: 0, failedProjects: [] }; };
  const { engine } = await setup(sync, [make('1')]);
  const a = await engine.runSingleCycle();
  const b = await engine.runSingleCycle();
  assert.equal(a.newProjectsFound, 1);
  assert.equal(b.newProjectsFound, 0);
  assert.equal(calls, 1);
});

test('stop() ends the watch loop promptly', async () => {
  const { engine } = await setup(async (b) => ({ ok: b.length, failed: 0, skipped: 0, failedProjects: [] }), []);
  const started = Date.now();
  const loop = engine.startMonitoring();
  setTimeout(() => engine.stop(), 50);
  await loop;
  assert.ok(Date.now() - started < 2_000, 'loop should not wait out its tick delay');
});
