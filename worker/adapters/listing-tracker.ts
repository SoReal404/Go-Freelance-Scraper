import type { NormalizedProject } from './types.ts';

/**
 * Keeps an in-process ID baseline while honoring the caller's time window.
 * A project that appears in a later poll is returned even if the marketplace's
 * displayed postedAt is older than the poll window (some feeds surface delayed rows).
 */
export function createNewListingTracker() {
  const seenIds = new Set<string>();
  let initialized = false;

  return (projects: NormalizedProject[], since: Date): NormalizedProject[] => {
    const fresh: NormalizedProject[] = [];
    for (const project of projects) {
      const wasSeen = seenIds.has(project.externalId);
      seenIds.add(project.externalId);
      if (project.postedAt >= since || (initialized && !wasSeen)) fresh.push(project);
    }
    initialized = true;
    return fresh;
  };
}
