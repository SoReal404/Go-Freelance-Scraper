import type { PlatformAdapter, PlatformId, PlatformRegion } from './types.ts';
import { mostaqlAdapter } from './mostaql.ts';
import { nafezlyAdapter } from './nafezly.ts';
import { shoghlonlineAdapter } from './shoghlonline.ts';
import { freelanceArabsAdapter } from './freelance-arabs.ts';
import { freelancerAdapter } from './freelancer.ts';
import { peoplePerHourAdapter } from './peopleperhour.ts';
// Upwork and Guru removed — require paid credentials / WAF bypass not worth the block risk

export * from './types.ts';
export * from './listing-tracker.ts';
export * from './mostaql.ts';
export * from './nafezly.ts';
export * from './shoghlonline.ts';
export * from './freelance-arabs.ts';
export * from './freelancer.ts';
export * from './peopleperhour.ts';

export const allAdapters: PlatformAdapter[] = [
  // Middle East Marketplaces
  mostaqlAdapter,
  nafezlyAdapter,
  shoghlonlineAdapter,
  freelanceArabsAdapter,

  // International Marketplaces
  freelancerAdapter,
  peoplePerHourAdapter,
];

export const adaptersById = new Map<PlatformId, PlatformAdapter>(
  allAdapters.map((adapter) => [adapter.id, adapter]),
);

export function getAdapter(id: PlatformId): PlatformAdapter | undefined {
  return adaptersById.get(id);
}

export function getAdaptersByRegion(region: PlatformRegion | 'all'): PlatformAdapter[] {
  if (region === 'all') return allAdapters;
  return allAdapters.filter((adapter) => adapter.region === region);
}
