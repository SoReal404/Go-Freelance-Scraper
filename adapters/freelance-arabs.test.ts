import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseFreelanceArabsDate, parseFreelanceArabsProjects } from './freelance-arabs.ts';

test('parses observed Arabic month/date labels', () => {
  assert.equal(parseFreelanceArabsDate('مارس 4, 2026')?.toISOString(), '2026-03-04T00:00:00.000Z');
  assert.equal(parseFreelanceArabsDate('يناير 31, 2026')?.toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(parseFreelanceArabsDate('تاريخ غير معروف'), undefined);
});

const FIXTURE = new URL('../spike/samples/freelance-arabs-listing.html', import.meta.url);
// The saved sample page is not committed (third-party HTML); the test only runs where the file exists.
test('parses public FreelanceArabs archive entries without inventing budget or skills', { skip: !existsSync(FIXTURE) && 'sample HTML not present' }, async () => {
  const html = await readFile(FIXTURE, 'utf8');
  const parsed = parseFreelanceArabsProjects(html);
  assert.ok(parsed.rowCount > 0);
  assert.ok(parsed.projects.length > 0);
  assert.equal(parsed.parseErrors, 0);
  assert.ok(parsed.projects.every((project) => project.budgetMin === undefined && project.skills.length === 0));
});
