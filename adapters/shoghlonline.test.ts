import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseShoghlonlineProjects, parseShoghlonlineRelativeTime } from './shoghlonline.ts';

const seenAt = new Date('2026-09-29T20:37:06.000Z');

test('parses captured Shoghlonline relative labels', () => {
  assert.equal(parseShoghlonlineRelativeTime('أول أمس', seenAt)?.toISOString(), '2026-09-27T20:37:06.000Z');
  assert.equal(parseShoghlonlineRelativeTime('الشهر الماضي', seenAt)?.toISOString(), '2026-08-30T20:37:06.000Z');
  assert.equal(parseShoghlonlineRelativeTime('قبل 11 شهرًا', seenAt)?.getUTCMonth(), 10);
});

test('parses public Shoghlonline cards with description and named skills', async () => {
  const html = await readFile(new URL('../spike/samples/shoghlonline-listing.html', import.meta.url), 'utf8');
  const parsed = parseShoghlonlineProjects(html, seenAt);
  assert.equal(parsed.rowCount, 15);
  assert.ok(parsed.projects.length > 0);
  assert.equal(parsed.parseErrors, 0);
  assert.ok(parsed.projects.some((project) => project.title === 'مدير حسابات محترف وذو خبرة' && project.skills.includes('تحليل البيانات')));
});
