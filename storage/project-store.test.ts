import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from './project-store.ts';
import type { NormalizedProject } from '../adapters/types.ts';

const project = (id: string, over: Partial<NormalizedProject> = {}): NormalizedProject => ({
  platform: 'mostaql',
  externalId: id,
  title: `Project ${id}`,
  description: 'desc',
  url: `https://mostaql.com/project/${id}`,
  skills: [],
  postedAt: new Date('2026-10-12T10:00:00Z'),
  ...over,
});

test('upsertMany writes a whole batch in one pass and reports inserted vs updated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const store = new ProjectStore(join(dir, 'projects.json'));

  const first = await store.upsertMany([project('1'), project('2'), project('1', { title: 'dup in batch' })]);
  assert.deepEqual(first.map((r) => r.inserted), [true, true, false]);
  assert.equal(store.has('mostaql', '1'), true);

  const second = await store.upsertMany([project('2', { title: 'renamed' }), project('3')]);
  assert.deepEqual(second.map((r) => r.inserted), [false, true]);

  const doc = JSON.parse(await readFile(join(dir, 'projects.json'), 'utf8'));
  assert.equal(doc.total_projects, 3);
  assert.equal(doc.projects.find((p: any) => p.external_id === '2').title, 'renamed');
  assert.equal(doc.projects.find((p: any) => p.external_id === '1').title, 'dup in batch');
});

test('first_seen_at survives later updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const store = new ProjectStore(join(dir, 'projects.json'));
  await store.upsertMany([project('9', { firstSeenAt: new Date('2026-10-01T00:00:00Z') })]);
  await store.upsertMany([project('9', { firstSeenAt: new Date('2026-10-12T00:00:00Z') })]);
  const [stored] = await store.readAll();
  assert.equal(stored.first_seen_at, '2026-10-01T00:00:00.000Z');
});

test('empty batch is a no-op', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const store = new ProjectStore(join(dir, 'projects.json'));
  assert.deepEqual(await store.upsertMany([]), []);
});

test('pruneOlderThan removes projects older than threshold and updates seenKeys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const store = new ProjectStore(join(dir, 'projects.json'));

  const now = Date.now();
  const freshDate = new Date(now - 1 * 24 * 60 * 60 * 1000); // 1 day old
  const oldDate = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days old

  await store.upsertMany([
    project('fresh', { postedAt: freshDate, firstSeenAt: freshDate }),
    project('old', { postedAt: oldDate, firstSeenAt: oldDate }),
  ]);

  assert.equal(store.has('mostaql', 'fresh'), true);
  assert.equal(store.has('mostaql', 'old'), true);

  const pruned = await store.pruneOlderThan(3); // threshold 3 days
  assert.equal(pruned, 1, 'should prune 1 old project');

  assert.equal(store.has('mostaql', 'fresh'), true, 'fresh project remains in seenKeys');
  assert.equal(store.has('mostaql', 'old'), false, 'old project removed from seenKeys');

  const remaining = await store.readAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].external_id, 'fresh');
});
