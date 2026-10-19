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
 *
 * SECURITY (run once as well): the website only needs to READ. The worker writes with the
 * service-role / secret key, which bypasses RLS, so anonymous visitors must get SELECT only:
 *
 *   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
 *   DROP POLICY IF EXISTS "public read" ON projects;
 *   CREATE POLICY "public read" ON projects FOR SELECT TO anon, authenticated USING (true);
 *   -- and remove any INSERT / UPDATE / DELETE policies that allow the anon role.
 *
 * Put the key in SUPABASE_SERVICE_ROLE_KEY on the server only. Never in the website, never in git.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedProject } from '../adapters/types.ts';

export type SyncResult = 'ok' | 'skipped' | 'failed';

let _client: SupabaseClient | null = null;
let _warned = false;

function getClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  // Server-side writes must use the service-role (secret) key. The anon key is public by design,
  // so using it for writes means the table has to allow anonymous writes, which is unsafe.
  const privilegedKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = privilegedKey || anonKey;

  if (!url || !key) {
    if (!_warned) {
      console.warn('[Supabase] SUPABASE_URL or key not set, skipping DB sync.');
      _warned = true;
    }
    return null;
  }
  if (!privilegedKey && !_warned) {
    console.warn(
      '[Supabase] Writing with SUPABASE_ANON_KEY. Switch to SUPABASE_SERVICE_ROLE_KEY and make the table read-only for anon (see SQL at the top of this file).',
    );
    _warned = true;
  }

  _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

export function projectToRow(project: NormalizedProject) {
  return {
    id: `${project.platform}:${project.externalId}`,
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
  };
}

/**
 * Upsert a single project to Supabase. Never throws.
 * Returns 'failed' so the caller can retry later (a failure used to be silently lost because the
 * project was already marked as seen in the local store).
 */
export async function upsertProjectToSupabase(project: NormalizedProject): Promise<SyncResult> {
  const result = await upsertProjectsBatch([project]);
  return result.failed === 0 && result.skipped === 0 ? 'ok' : result.skipped ? 'skipped' : 'failed';
}

/** Upsert in chunks. Used for retries and for the one-off `--sync` backfill. */
export async function upsertProjectsBatch(
  projects: NormalizedProject[],
  chunkSize = 100,
): Promise<{ ok: number; failed: number; skipped: number; failedProjects: NormalizedProject[] }> {
  const client = getClient();
  if (!client) return { ok: 0, failed: 0, skipped: projects.length, failedProjects: [] };

  let ok = 0;
  const failedProjects: NormalizedProject[] = [];
  for (let i = 0; i < projects.length; i += chunkSize) {
    const chunk = projects.slice(i, i + chunkSize);
    try {
      const { error } = await client.from('projects').upsert(chunk.map(projectToRow), { onConflict: 'id' });
      if (error) {
        console.error(`[Supabase] Upsert failed for ${chunk.length} project(s):`, error.message);
        failedProjects.push(...chunk);
      } else {
        ok += chunk.length;
      }
    } catch (err: unknown) {
      console.error('[Supabase] Unexpected error:', err instanceof Error ? err.message : String(err));
      failedProjects.push(...chunk);
    }
  }
  return { ok, failed: failedProjects.length, skipped: 0, failedProjects };
}

/**
 * Delete projects older than `maxAgeDays` (default: 3 days) from Supabase.
 * Checks `posted_at < cutoff`, falling back to `(posted_at IS NULL AND created_at < cutoff)`.
 */
export async function deleteProjectsOlderThan(
  maxAgeDays = 3,
): Promise<{ deleted: number; error?: string }> {
  const client = getClient();
  if (!client) return { deleted: 0 };

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;

  try {
    // 1. Delete rows where posted_at < cutoff
    const { data: d1, error: err1 } = await client
      .from('projects')
      .delete()
      .lt('posted_at', cutoff)
      .select('id');

    if (err1) {
      console.error('[Supabase] Error deleting old projects by posted_at:', err1.message);
      return { deleted: totalDeleted, error: err1.message };
    }
    if (d1) totalDeleted += d1.length;

    // 2. Also clean up any legacy rows where posted_at is null but created_at < cutoff
    const { data: d2, error: err2 } = await client
      .from('projects')
      .delete()
      .is('posted_at', null)
      .lt('created_at', cutoff)
      .select('id');

    if (err2) {
      console.error('[Supabase] Error deleting old projects by created_at:', err2.message);
      return { deleted: totalDeleted, error: err2.message };
    }
    if (d2) totalDeleted += d2.length;

    return { deleted: totalDeleted };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Supabase] Unexpected error deleting old projects:', msg);
    return { deleted: totalDeleted, error: msg };
  }
}
