import { mkdir, appendFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  fetchShoghlonlineHtml, parseShoghlonlineProjects, shoghlonlineAdapter,
} from '../adapters/shoghlonline.ts';
import {
  fetchNafezlyHtml, parseNafezlyProjects, nafezlyAdapter,
} from '../adapters/nafezly.ts';
import {
  fetchFreelanceArabsHtml, parseFreelanceArabsProjects, freelanceArabsAdapter,
} from '../adapters/freelance-arabs.ts';

const durationHours = Number(process.env.BATCH2_SPIKE_HOURS ?? '12');
if (!Number.isFinite(durationHours) || durationHours <= 0) throw new Error('BATCH2_SPIKE_HOURS must be positive.');
const durationMs = durationHours * 60 * 60 * 1000;
const startedAt = Date.now();
const deadline = startedAt + durationMs;
const logDirectory = resolve('spike/logs');
await mkdir(logDirectory, { recursive: true });
const timestamp = new Date(startedAt).toISOString().replaceAll(':', '-').replaceAll('.', '-');
const logPath = resolve(process.env.BATCH2_SPIKE_LOG ?? `${logDirectory}/batch2-live-${timestamp}.jsonl`);
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const challengePattern = /cf-challenge|cf-chl-|cf_chl_opt|challenge-form|hcaptcha-challenge|verify you are human|just a moment|access denied/i;
const sources = [
  {
    adapter: shoghlonlineAdapter,
    fetch: fetchShoghlonlineHtml,
    parse: parseShoghlonlineProjects,
  },
  {
    adapter: nafezlyAdapter,
    fetch: fetchNafezlyHtml,
    parse: parseNafezlyProjects,
  },
  {
    adapter: freelanceArabsAdapter,
    fetch: fetchFreelanceArabsHtml,
    parse: parseFreelanceArabsProjects,
  },
].map(({ adapter, fetch, parse }) => ({
  adapter,
  fetch,
  parse,
  ids: new Set(),
  initialized: false,
  blocked: false,
  polls: 0,
  uniqueNewProjects: 0,
  parseErrors: 0,
  httpErrors: 0,
  nextPollAt: startedAt,
}));

async function log(entry) {
  const line = JSON.stringify(entry);
  console.log(line);
  await appendFile(logPath, `${line}\n`, 'utf8');
}

async function poll(source) {
  const { adapter } = source;
  source.polls += 1;
  try {
    const response = await source.fetch();
    if (response.status < 200 || response.status >= 300) {
      source.httpErrors += 1;
      const blocked = response.status === 403 || response.status === 429;
      source.blocked ||= blocked;
      await log({ event: blocked ? 'blocked' : 'http_error', platform: adapter.id, poll: source.polls, status: response.status, detail: `HTTP ${response.status}` });
      return;
    }
    const title = response.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? '';
    if (challengePattern.test(response.html) || /verify you are human|just a moment|access denied/i.test(title)) {
      source.blocked = true;
      await log({ event: 'blocked', platform: adapter.id, poll: source.polls, status: response.status, detail: 'Challenge/CAPTCHA marker detected; polling stopped without bypass.' });
      return;
    }

    const seenAt = new Date();
    const parsed = source.parse(response.html, seenAt);
    source.parseErrors += parsed.parseErrors;
    if (!parsed.rowCount) {
      source.httpErrors += 1;
      await log({ event: 'parse_error', platform: adapter.id, poll: source.polls, rows: 0, parse_errors: parsed.parseErrors, detail: 'No listing rows found.' });
      return;
    }
    await log({ event: 'poll', platform: adapter.id, poll: source.polls, baseline: !source.initialized, rows: parsed.rowCount, projects: parsed.projects.length, parse_errors: parsed.parseErrors, url: response.url });

    for (const project of parsed.projects) {
      if (source.ids.has(project.externalId)) continue;
      source.ids.add(project.externalId);
      if (!source.initialized) continue;
      source.uniqueNewProjects += 1;
      const ageMinutes = Math.max(0, (seenAt.getTime() - project.postedAt.getTime()) / 60_000);
      await log({
        event: 'new_project',
        platform: adapter.id,
        title: project.title,
        description: project.description,
        budget_min: project.budgetMin ?? null,
        budget_max: project.budgetMax ?? null,
        currency: project.currency ?? null,
        skills: project.skills,
        url: project.url,
        posted_at: project.postedAt.toISOString(),
        first_seen_at: seenAt.toISOString(),
        age_minutes_when_seen: Number(ageMinutes.toFixed(2)),
      });
    }
    source.initialized = true;
  } catch (error) {
    source.httpErrors += 1;
    const detail = error instanceof Error ? error.message : 'Unknown request error';
    if (/blocked|challenge|captcha|HTTP (403|429)/i.test(detail)) source.blocked = true;
    await log({ event: source.blocked ? 'blocked' : 'http_error', platform: adapter.id, poll: source.polls, detail });
  }
}

await log({
  event: 'spike_started',
  platforms: sources.map((source) => source.adapter.id),
  started_at: new Date(startedAt).toISOString(),
  duration_hours: durationHours,
  log_file: basename(logPath),
  note: 'Initial listing is the baseline. New IDs are detected from public listing pages; no project detail pages are fetched.',
});
// Each source gets one baseline request; different sites may be polled together.
await Promise.all(sources.map(async (source) => {
  await poll(source);
  source.nextPollAt = Date.now() + source.adapter.pollIntervalMs * (0.8 + Math.random() * 0.4);
}));

while (Date.now() < deadline && sources.some((source) => !source.blocked)) {
  const active = sources.filter((source) => !source.blocked);
  const nextPollAt = Math.min(...active.map((source) => source.nextPollAt));
  await wait(Math.max(0, Math.min(nextPollAt - Date.now(), deadline - Date.now())));
  if (Date.now() >= deadline) break;
  const due = sources.filter((source) => !source.blocked && source.nextPollAt <= Date.now());
  await Promise.all(due.map(async (source) => {
    await poll(source);
    // Jittered 48–72 second interval; each adapter is strictly sequential per site.
    source.nextPollAt = Date.now() + source.adapter.pollIntervalMs * (0.8 + Math.random() * 0.4);
  }));
}

const elapsedMinutes = (Date.now() - startedAt) / 60_000;
await log({
  event: 'summary',
  finished_at: new Date().toISOString(),
  elapsed_minutes: Number(elapsedMinutes.toFixed(2)),
  platforms: sources.map((source) => ({
    platform: source.adapter.id,
    polls: source.polls,
    unique_new_projects: source.uniqueNewProjects,
    parse_errors: source.parseErrors,
    http_errors: source.httpErrors,
    rough_projects_per_hour: Number((source.uniqueNewProjects / elapsedMinutes * 60).toFixed(2)),
    blocked: source.blocked,
  })),
  log_file: logPath,
});
