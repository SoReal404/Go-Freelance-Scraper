import { randomUUID } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchMostaqlHtml, parseMostaqlProjects, MOSTAQL_USER_AGENT } from '../adapters/mostaql.ts';
import { fetchShoghlonlineHtml, parseShoghlonlineProjects, SHOGHLONLINE_USER_AGENT, shoghlonlineAdapter } from '../adapters/shoghlonline.ts';
import { fetchNafezlyHtml, parseNafezlyProjects, NAFEZLY_USER_AGENT, nafezlyAdapter } from '../adapters/nafezly.ts';
import { fetchFreelanceArabsHtml, parseFreelanceArabsProjects, FREELANCE_ARABS_USER_AGENT, freelanceArabsAdapter } from '../adapters/freelance-arabs.ts';
import { createFreelancerSource } from './freelancer-source.mjs';
import { fetchPublicProjectDetail, parsePublicProjectDetail } from './project-detail.mjs';
import { readProjectStore, upsertProject } from './project-store.mjs';

const group = process.argv[2];
if (!['middle-east', 'international'].includes(group)) throw new Error('Usage: node live-group-runner.mjs <middle-east|international>');
const durationHours = Number(process.env.LIVE_SCRAPER_HOURS ?? '12');
if (!Number.isFinite(durationHours) || durationHours <= 0) throw new Error('LIVE_SCRAPER_HOURS must be a positive number.');
const storePath = resolve(process.env.LIVE_PROJECTS_FILE ?? 'data/projects.json');
const logsDirectory = resolve('data/run-logs');
await mkdir(logsDirectory, { recursive: true });
const runId = randomUUID();
const logPath = resolve(logsDirectory, `${group}-${new Date().toISOString().replaceAll(':', '-')}.jsonl`);
const startedAt = Date.now();
const deadline = startedAt + durationHours * 3_600_000;
const minRequestGapMs = 25_000;
const maxRequestGapMs = 35_000;
const blockedPattern = /cf-challenge|cf-chl-|cf_chl_opt|challenge-form|hcaptcha-challenge|verify you are human|just a moment|access denied/i;
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

const htmlSource = ({ adapter, fetch, parse, userAgent }) => ({
  id: adapter.id,
  group: 'middle_east',
  pollIntervalMs: adapter.pollIntervalMs,
  async fetchListing() {
    const response = await fetch();
    if (response.status < 200 || response.status >= 300) return { ...response, projects: [], rowCount: 0 };
    const parsed = parse(response.html, new Date());
    return { ...response, projects: parsed.projects, rowCount: parsed.rowCount, parseErrors: parsed.parseErrors };
  },
  fetchDetail(project) { return fetchPublicProjectDetail(project, userAgent); },
});

const middleEastSources = [
  htmlSource({ adapter: { id: 'mostaql', pollIntervalMs: 60_000 }, fetch: fetchMostaqlHtml, parse: parseMostaqlProjects, userAgent: MOSTAQL_USER_AGENT }),
  htmlSource({ adapter: shoghlonlineAdapter, fetch: fetchShoghlonlineHtml, parse: parseShoghlonlineProjects, userAgent: SHOGHLONLINE_USER_AGENT }),
  htmlSource({ adapter: nafezlyAdapter, fetch: fetchNafezlyHtml, parse: parseNafezlyProjects, userAgent: NAFEZLY_USER_AGENT }),
  htmlSource({ adapter: freelanceArabsAdapter, fetch: fetchFreelanceArabsHtml, parse: parseFreelanceArabsProjects, userAgent: FREELANCE_ARABS_USER_AGENT }),
];
const sources = group === 'middle-east'
  ? middleEastSources
  : [createFreelancerSource(process.env.FREELANCER_OAUTH_TOKEN)];

const log = async (entry) => {
  const line = JSON.stringify({ run_id: runId, group, at: new Date().toISOString(), ...entry });
  console.log(line);
  await appendFile(logPath, `${line}\n`, 'utf8');
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const sourceStats = new Map(sources.map((source) => [source.id, { polls: 0, found: 0, enriched: 0, detailErrors: 0, httpErrors: 0, blocked: false }]));
const savedProjects = await readProjectStore(storePath);
const savedKeys = new Set(savedProjects.map((project) => `${project.platform}\0${project.external_id}`));
const sleepToPace = async (source) => {
  if (source.lastRequestAt) {
    const gap = minRequestGapMs + Math.random() * (maxRequestGapMs - minRequestGapMs);
    const remaining = source.lastRequestAt + gap - Date.now();
    if (remaining > 0) await pause(remaining);
  }
  source.lastRequestAt = Date.now();
};
const makeRecord = (source, project, seenAt, detail = {}) => {
  const budget = detail.budget ?? project.budget ?? {
    ...(project.budgetMin != null ? { min: project.budgetMin } : {}),
    ...(project.budgetMax != null ? { max: project.budgetMax } : {}),
    ...(project.currency ? { currency: project.currency } : {}),
    ...(project.budgetType ? { type: project.budgetType } : {}),
  };
  const skills = [...new Set([...(project.skills ?? []), ...(detail.skills ?? [])])];
  const descriptionFull = detail.description && detail.description.length >= (project.description?.length ?? 0) ? detail.description : undefined;
  return {
    platform: source.id,
    source_group: source.group,
    external_id: String(project.externalId),
    title: project.title,
    description: descriptionFull ?? project.description ?? '',
    listing_description: project.description ?? '',
    budget: { min: budget.min ?? null, max: budget.max ?? null, currency: budget.currency ?? null, type: budget.type ?? null },
    skills,
    project_url: project.url,
    posted_at: project.postedAt instanceof Date ? project.postedAt.toISOString() : project.postedAt,
    first_seen_at: seenAt.toISOString(),
    details: {
      status: detail.status ?? 'pending',
      fetched_at: detail.fetchedAt ?? null,
      detail_url: detail.detailUrl ?? null,
      fields_found: detail.fieldsFound ?? [],
      project_page_text: detail.pageText ?? null,
      error: detail.error ?? null,
    },
    last_updated_at: new Date().toISOString(),
  };
};

await log({ event: 'started', duration_hours: durationHours, platforms: sources.map((source) => source.id), output_file: storePath, run_log: logPath, request_gap_seconds: [25, 35] });

async function runSource(source) {
  let initialized = false;
  const seenIds = new Set();
  const stats = sourceStats.get(source.id);
  while (!stopping && Date.now() < deadline && !stats.blocked) {
    stats.polls += 1;
    let listing;
    try {
      await sleepToPace(source);
      listing = await source.fetchListing();
      if (listing.status < 200 || listing.status >= 300) {
        stats.httpErrors += 1;
        stats.blocked ||= listing.status === 403 || listing.status === 429;
        await log({ event: stats.blocked ? 'blocked' : 'http_error', platform: source.id, stage: 'listing', status: listing.status });
      } else if (listing.html && blockedPattern.test(listing.html)) {
        stats.blocked = true;
        await log({ event: 'blocked', platform: source.id, stage: 'listing', detail: 'challenge page detected; stopped without bypass' });
      } else if (!listing.rowCount) {
        stats.httpErrors += 1;
        await log({ event: 'parse_error', platform: source.id, stage: 'listing', detail: 'No listing rows returned.' });
      } else {
        await log({ event: 'poll', platform: source.id, poll: stats.polls, baseline: !initialized, rows: listing.rowCount, parse_errors: listing.parseErrors ?? 0, status: listing.status });
        for (const project of listing.projects) {
          const id = String(project.externalId ?? '');
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          const key = `${source.id}\0${id}`;
          if (!initialized && !savedKeys.has(key)) continue;
          if (savedKeys.has(key)) continue;
          const seenAt = new Date();
          stats.found += 1;
          await upsertProject(makeRecord(source, project, seenAt), storePath);
          savedKeys.add(key);
          await log({ event: 'new_project', platform: source.id, external_id: id, title: project.title, project_url: project.url, store_status: 'details_pending' });
          try {
            await sleepToPace(source);
            const detailResponse = await source.fetchDetail(project);
            const fetchedAt = new Date().toISOString();
            if (detailResponse.status === 403 || detailResponse.status === 429 || (detailResponse.html && blockedPattern.test(detailResponse.html))) {
              stats.blocked = true;
              stats.detailErrors += 1;
              await upsertProject(makeRecord(source, project, seenAt, { status: 'blocked', fetchedAt, detailUrl: detailResponse.url, error: `Detail fetch blocked (HTTP ${detailResponse.status}).` }), storePath);
              await log({ event: 'blocked', platform: source.id, external_id: id, stage: 'detail', status: detailResponse.status });
              break;
            }
            if (detailResponse.status < 200 || detailResponse.status >= 300) throw new Error(`Detail fetch returned HTTP ${detailResponse.status}.`);
            let enrichment;
            if (detailResponse.detail) {
              const detailProject = detailResponse.detail;
              enrichment = {
                description: detailProject.description,
                skills: detailProject.skills,
                budget: detailProject.budget,
                fieldsFound: ['description', ...(detailProject.budget.min != null || detailProject.budget.max != null ? ['budget'] : []), ...(detailProject.skills.length ? ['skills'] : [])],
                pageText: detailResponse.rawProject ? JSON.stringify(detailResponse.rawProject) : null,
              };
            } else {
              enrichment = parsePublicProjectDetail(detailResponse.html, project);
            }
            const fieldsFound = enrichment.fieldsFound ?? [];
            const allCoreFields = Boolean(enrichment.description) && Boolean(enrichment.skills?.length) && Boolean(enrichment.budget?.min != null || enrichment.budget?.max != null);
            const detail = {
              ...enrichment,
              fieldsFound,
              status: allCoreFields ? 'complete' : 'partial',
              fetchedAt,
              detailUrl: detailResponse.url,
            };
            await upsertProject(makeRecord(source, project, seenAt, detail), storePath);
            stats.enriched += 1;
            await log({ event: 'detail_enriched', platform: source.id, external_id: id, fields_found: fieldsFound, missing_fields: ['full_description', 'budget', 'skills'].filter((name) => !fieldsFound.includes(name)), status: detail.status });
          } catch (error) {
            stats.detailErrors += 1;
            await upsertProject(makeRecord(source, project, seenAt, { status: 'error', fetchedAt: new Date().toISOString(), detailUrl: project.url, error: error instanceof Error ? error.message : 'Unknown detail error' }), storePath);
            await log({ event: 'detail_error', platform: source.id, external_id: id, detail: error instanceof Error ? error.message : 'Unknown detail error' });
          }
        }
        initialized = true;
      }
    } catch (error) {
      stats.httpErrors += 1;
      await log({ event: 'http_error', platform: source.id, stage: 'listing', detail: error instanceof Error ? error.message : 'Unknown request error' });
    }
    if (!stopping && Date.now() < deadline && !stats.blocked) {
      const delay = source.pollIntervalMs * (0.8 + Math.random() * 0.4);
      await pause(Math.min(delay, deadline - Date.now()));
    }
  }
}

await Promise.all(sources.map(runSource));
await log({ event: 'finished', elapsed_minutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)), platforms: Object.fromEntries(sourceStats), output_file: storePath });
