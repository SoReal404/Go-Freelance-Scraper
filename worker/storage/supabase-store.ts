/**
 * Supabase integration for GO Freelance worker.
 *
 * Each scraped project is upserted into the `projects` table on Supabase.
 * If SUPABASE_URL / SUPABASE_ANON_KEY are not set the module is a safe no-op
 * so the worker continues to work with only local JSON storage.
 *
 * SQL to run once in Supabase SQL Editor (Dashboard → SQL Editor → New Query):
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS projects (
 *   id              TEXT PRIMARY KEY,          -- '{platform}:{externalId}'
 *   platform        TEXT NOT NULL,
 *   external_id     TEXT NOT NULL,
 *   title           TEXT NOT NULL,
 *   description     TEXT,
 *   listing_desc    TEXT,
 *   url             TEXT NOT NULL,
 *   budget_min      NUMERIC,
 *   budget_max      NUMERIC,
 *   currency        TEXT,
 *   budget_type     TEXT,
 *   skills          TEXT[]  DEFAULT '{}',
 *   category        TEXT,
 *   language        TEXT    DEFAULT 'en',
 *   posted_at       TIMESTAMPTZ,
 *   first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
 *   details_enriched BOOLEAN DEFAULT FALSE,
 *   created_at      TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at      TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_projects_platform   ON projects(platform);
 * CREATE INDEX IF NOT EXISTS idx_projects_posted_at  ON projects(posted_at DESC);
 * CREATE INDEX IF NOT EXISTS idx_projects_skills     ON projects USING GIN(skills);
 *
 * -- Auto-update updated_at on every row change
 * CREATE OR REPLACE FUNCTION update_updated_at()
 * RETURNS TRIGGER LANGUAGE plpgsql AS $$
 * BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
 * $$;
 * CREATE TRIGGER trg_projects_updated_at
 *   BEFORE UPDATE ON projects
 *   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedProject } from '../adapters/types.ts';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Warn once, then stay silent
    if (!process.env._SUPABASE_WARNED) {
      console.warn('[Supabase] SUPABASE_URL or SUPABASE_ANON_KEY not set — skipping DB sync.');
      process.env._SUPABASE_WARNED = '1';
    }
    return null;
  }

  _client = createClient(url, key);
  return _client;
}

/**
 * Upsert a single project to Supabase.
 * Silently skips if credentials are not configured.
 * Never throws — a Supabase failure must not crash the scraper.
 */
export async function upsertProjectToSupabase(project: NormalizedProject): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const id = `${project.platform}:${project.externalId}`;
    const { error } = await client.from('projects').upsert(
      {
        id,
        platform: project.platform,
        external_id: project.externalId,
        title: project.title,
        description: project.description ?? '',
        listing_desc: project.listingDescription ?? null,
        url: project.url,
        budget_min: project.budgetMin ?? null,
        budget_max: project.budgetMax ?? null,
        currency: project.currency ?? null,
        budget_type: project.budgetType ?? null,
        skills: project.skills,
        category: project.category ?? null,
        language: project.language ?? 'en',
        posted_at: project.postedAt?.toISOString() ?? null,
        first_seen_at: project.firstSeenAt?.toISOString() ?? new Date().toISOString(),
        details_enriched: project.detailsEnriched ?? false,
      },
      { onConflict: 'id' },
    );

    if (error) {
      console.error(`[Supabase] Upsert failed for ${id}:`, error.message);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Supabase] Unexpected error:', msg);
  }
}

/**
 * Upsert a batch of projects. Used after the initial scrape cycle.
 */
export async function upsertProjectsBatch(projects: NormalizedProject[]): Promise<void> {
  for (const project of projects) {
    await upsertProjectToSupabase(project);
  }
}
