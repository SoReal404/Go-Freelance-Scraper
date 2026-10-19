import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseShoghlonlineProjects, parseShoghlonlineRelativeTime } from './shoghlonline.ts';

const seenAt = new Date('2026-09-29T20:37:06.000Z');

test('parses captured Shoghlonline relative labels', () => {
  assert.equal(parseShoghlonlineRelativeTime('أول أمس', seenAt)?.toISOString(), '2026-09-27T20:37:06.000Z');
  assert.equal(parseShoghlonlineRelativeTime('الشهر الماضي', seenAt)?.toISOString(), '2026-08-30T20:37:06.000Z');
  assert.equal(parseShoghlonlineRelativeTime('قبل 11 شهرًا', seenAt)?.getUTCMonth(), 10);
});

const FIXTURE = new URL('../spike/samples/shoghlonline-listing.html', import.meta.url);
// The saved sample page is not committed (third-party HTML); the test only runs where the file exists.
test('parses public Shoghlonline cards with description and named skills', { skip: !existsSync(FIXTURE) && 'sample HTML not present' }, async () => {
  const html = await readFile(FIXTURE, 'utf8');
  const parsed = parseShoghlonlineProjects(html, seenAt);
  assert.equal(parsed.rowCount, 15);
  assert.ok(parsed.projects.length > 0);
  assert.equal(parsed.parseErrors, 0);
  assert.ok(parsed.projects.some((project) => project.title === 'مدير حسابات محترف وذو خبرة' && project.skills.includes('تحليل البيانات')));
});
