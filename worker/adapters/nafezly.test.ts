import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseNafezlyBudget, parseNafezlyProjects, parseNafezlyRelativeTime } from './nafezly.ts';

const seenAt = new Date('2026-09-29T20:37:06.000Z');

test('parses captured Nafezly relative labels', () => {
  assert.equal(parseNafezlyRelativeTime('منذ ساعة', seenAt)?.toISOString(), '2026-09-29T19:37:06.000Z');
  assert.equal(parseNafezlyRelativeTime('منذ دقيقتين', seenAt)?.toISOString(), '2026-09-29T20:35:06.000Z');
  assert.equal(parseNafezlyRelativeTime('منذ ساعتين', seenAt)?.toISOString(), '2026-09-29T18:37:06.000Z');
  assert.equal(parseNafezlyRelativeTime('منذ 3 ساعات', seenAt)?.toISOString(), '2026-09-29T17:37:06.000Z');
});

test('parses displayed project budget ranges and currency', () => {
  assert.deepEqual(parseNafezlyBudget('25 - 50 $'), { budgetMin: 25, budgetMax: 50, currency: 'USD' });
  assert.deepEqual(parseNafezlyBudget('لا يوجد'), {});
});

test('parses public Nafezly project cards with title, description and budget', async () => {
  const html = await readFile(new URL('../spike/samples/nafezly-listing.html', import.meta.url), 'utf8');
  const parsed = parseNafezlyProjects(html, seenAt);
  assert.ok(parsed.rowCount > 0);
  assert.ok(parsed.projects.length > 0);
  assert.equal(parsed.parseErrors, 0);
  assert.ok(parsed.projects.some((project) => project.title.includes('ذكاء اصطناعي') && project.budgetMin === 25 && project.currency === 'USD'));
});
