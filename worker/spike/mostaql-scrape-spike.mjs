import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchMostaqlHtml, parseMostaqlProjects } from '../adapters/mostaql.ts';

const DURATION_HOURS = Number(process.env.MOSTAQL_SPIKE_HOURS ?? '0.25');
if (!Number.isFinite(DURATION_HOURS) || DURATION_HOURS <= 0) {
  throw new Error('MOSTAQL_SPIKE_HOURS must be a positive number.');
}
const DURATION_MS = DURATION_HOURS * 60 * 60 * 1000;
const startedAt = Date.now();
const deadline = startedAt + DURATION_MS;
const seenUrls = new Set();
let uniqueNewProjects = 0;
let usableTimestamps = 0;
let parseErrors = 0;
let httpErrors = 0;
let blocked = false;
let polls = 0;

const challengePattern = /challenge-platform|cf-challenge|cf-chl-|hcaptcha-challenge/i;
const samplePath = resolve('spike/samples/mostaql-listing.html');
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function poll(isBaseline = false) {
  polls += 1;
  let response;
  try {
    response = await fetchMostaqlHtml();
  } catch (error) {
    httpErrors += 1;
    console.log(JSON.stringify({ event: 'http_error', poll: polls, detail: error instanceof Error ? error.name : 'unknown' }));
    return;
  }

  if (response.status !== 200) {
    httpErrors += 1;
    const hardBlock = response.status === 403 || response.status === 429;
    if (hardBlock) blocked = true;
    console.log(JSON.stringify({ event: 'http_error', poll: polls, status: response.status, blocked: hardBlock }));
    return;
  }

  const title = response.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ?? '';
  if (challengePattern.test(response.html) || /verify you are human|just a moment|access denied|captcha/i.test(title)) {
    blocked = true;
    console.log(JSON.stringify({ event: 'challenge', poll: polls, detail: 'challenge/CAPTCHA marker in HTML; stopping without bypass' }));
    return;
  }

  if (polls === 1) {
    await mkdir(resolve('spike/samples'), { recursive: true });
    await writeFile(samplePath, response.html, 'utf8');
  }

  const seenAt = new Date();
  const parsed = parseMostaqlProjects(response.html, seenAt);
  parseErrors += parsed.parseErrors;
  console.log(JSON.stringify({ event: 'poll', poll: polls, baseline: isBaseline, rows: parsed.rowCount, parse_errors: parsed.parseErrors, url: response.url }));

  for (const project of parsed.projects) {
    if (seenUrls.has(project.url)) continue;
    seenUrls.add(project.url);
    if (isBaseline) continue;
    uniqueNewProjects += 1;
    const hasTimestamp = project.postedAt.getTime() <= seenAt.getTime();
    if (hasTimestamp) usableTimestamps += 1;
    const ageMinutes = hasTimestamp ? (seenAt.getTime() - project.postedAt.getTime()) / 60_000 : null;
    console.log(JSON.stringify({
      event: 'new_project',
      title: project.title.length > 100 ? `${project.title.slice(0, 97)}...` : project.title,
      posted_at: hasTimestamp ? project.postedAt.toISOString() : 'unknown',
      age_minutes_when_seen: ageMinutes === null ? 'unknown' : Number(ageMinutes.toFixed(2)),
    }));
  }
}

console.log(JSON.stringify({ event: 'spike_started', platform: 'mostaql', started_at: new Date(startedAt).toISOString(), duration_hours: DURATION_HOURS }));
await poll(true);

while (!blocked && Date.now() < deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) break;
  // 52.5 seconds with ±10% jitter (47.25–57.75 seconds).
  const interval = 52_500 * (0.9 + Math.random() * 0.2);
  await wait(Math.min(interval, remaining));
  if (!blocked && Date.now() < deadline) await poll(false);
}

const elapsedMinutes = (Date.now() - startedAt) / 60_000;
console.log(JSON.stringify({
  event: 'summary',
  platform: 'mostaql',
  finished_at: new Date().toISOString(),
  elapsed_minutes: Number(elapsedMinutes.toFixed(2)),
  polls,
  unique_new_projects: uniqueNewProjects,
  usable_timestamps: usableTimestamps,
  parse_errors: parseErrors,
  http_errors: httpErrors,
  rough_projects_per_hour: Number((uniqueNewProjects / elapsedMinutes * 60).toFixed(2)),
  blocked,
}));
