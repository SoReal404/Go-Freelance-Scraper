import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewListingTracker } from './listing-tracker.ts';
import type { NormalizedProject } from './types.ts';

function project(externalId: string, postedAt: string): NormalizedProject {
  return {
    platform: 'mostaql', externalId, title: externalId, description: '', url: `https://example.test/${externalId}`,
    skills: [], postedAt: new Date(postedAt),
  };
}

test('seeds the first listing as a baseline, then catches newly listed stale-dated rows', () => {
  const track = createNewListingTracker();
  const since = new Date('2026-09-29T20:00:00.000Z');
  const baseline = project('old', '2026-09-28T20:00:00.000Z');
  assert.deepEqual(track([baseline], since), []);

  const newlyListed = project('late-feed', '2026-09-28T18:00:00.000Z');
  assert.deepEqual(track([baseline, newlyListed], since), [newlyListed]);
});
