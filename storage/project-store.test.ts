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
