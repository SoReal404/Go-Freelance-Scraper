import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMostaqlRelativeTime } from './mostaql.ts';

const seenAt = new Date('2026-09-29T00:30:00.000Z');

test('parses the captured Mostaql label "منذ 43 دقيقة"', () => {
  assert.equal(parseMostaqlRelativeTime('منذ 43 دقيقة', seenAt)?.toISOString(), '2026-09-28T23:47:00.000Z');
});

test('parses the captured Mostaql label "منذ ساعتين"', () => {
  assert.equal(parseMostaqlRelativeTime('منذ ساعتين', seenAt)?.toISOString(), '2026-09-28T22:30:00.000Z');
});

test('parses the captured Mostaql label "منذ 3 ساعات"', () => {
  assert.equal(parseMostaqlRelativeTime('منذ 3 ساعات', seenAt)?.toISOString(), '2026-09-28T21:30:00.000Z');
});

test('returns undefined for an unrecognized time label', () => {
  assert.equal(parseMostaqlRelativeTime('منذ فترة', seenAt), undefined);
});

