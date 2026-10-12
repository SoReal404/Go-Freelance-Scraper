const API_URL =
  'https://www.freelancer.com/api/projects/0.1/projects/active/?limit=50&sort_field=time_submitted&sort_direction=desc';
const DURATION_MS = 30 * 60 * 1000;
const INTERVALS_MS = [20_000, 60_000];
const token = process.env.FREELANCER_OAUTH_TOKEN;

if (!token) {
  console.error('FREELANCER_OAUTH_TOKEN is required.');
  process.exit(1);
}

const arms = new Map(
  INTERVALS_MS.map((intervalMs) => [
    intervalMs,
    { intervalMs, ids: new Set(), delays: [], newProjects: 0, calls: 0, rateLimits: 0, errors: 0, nextAt: 0 },
  ]),
);

function findProjects(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) {
    if (payload.some((item) => item && typeof item === 'object' && ('id' in item || 'project_id' in item))) return payload;
    for (const item of payload) {
      const found = findProjects(item);
      if (found.length) return found;
    }
    return [];
  }
  for (const [key, value] of Object.entries(payload)) {
    if (/projects/i.test(key) && Array.isArray(value)) return value;
  }
  for (const value of Object.values(payload)) {
    const found = findProjects(value);
    if (found.length) return found;
  }
  return [];
}

function projectId(project) {
  return String(project.id ?? project.project_id ?? '');
}

function postedAt(project) {
  const raw = project.time_submitted ?? project.posted_at ?? project.postedAt ?? project.created_at;
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === 'number' ? (raw < 10_000_000_000 ? raw * 1000 : raw) : raw;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function poll(arm, baseline = false) {
  arm.calls += 1;
  const seenAt = new Date();
  let response;
  try {
    response = await fetch(API_URL, {
      headers: { 'Freelancer-OAuth-V1': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    arm.errors += 1;
    console.log(JSON.stringify({ event: 'poll_error', interval_seconds: arm.intervalMs / 1000, detail: error.name }));
    return;
  }
  if (response.status === 429) arm.rateLimits += 1;
  if (!response.ok) {
    arm.errors += 1;
    console.log(JSON.stringify({ event: 'poll_error', interval_seconds: arm.intervalMs / 1000, status: response.status }));
    return;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    arm.errors += 1;
    console.log(JSON.stringify({ event: 'poll_error', interval_seconds: arm.intervalMs / 1000, detail: 'invalid_json' }));
    return;
  }
  const projects = findProjects(payload);
  for (const project of projects) {
    const id = projectId(project);
    if (!id || arm.ids.has(id)) continue;
    arm.ids.add(id);
    if (baseline) continue;
    arm.newProjects += 1;
    const posted = postedAt(project);
    const delaySeconds = posted ? (seenAt.getTime() - posted.getTime()) / 1000 : null;
    if (delaySeconds !== null && delaySeconds >= 0) arm.delays.push(delaySeconds);
    console.log(JSON.stringify({
      event: 'new_project',
      interval_seconds: arm.intervalMs / 1000,
      project_id: id,
      posted_at: posted?.toISOString() ?? null,
      seen_at: seenAt.toISOString(),
      delay_seconds: delaySeconds === null ? null : Number(delaySeconds.toFixed(3)),
      fields_available: Object.keys(project).sort(),
    }));
  }
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  return Number(sortedValues[Math.ceil(p * sortedValues.length) - 1].toFixed(3));
}

const startedAt = Date.now();
const deadline = startedAt + DURATION_MS;
console.log(JSON.stringify({ event: 'spike_started', started_at: new Date(startedAt).toISOString(), duration_minutes: 30, intervals_seconds: INTERVALS_MS.map((ms) => ms / 1000) }));

for (const arm of arms.values()) {
  await poll(arm, true);
  arm.nextAt = Date.now() + arm.intervalMs;
}

while (Date.now() < deadline) {
  const now = Date.now();
  for (const arm of arms.values()) {
    if (now >= arm.nextAt) {
      await poll(arm);
      arm.nextAt = Date.now() + arm.intervalMs + Math.random() * 1_500;
    }
  }
  const nextAt = Math.min(...[...arms.values()].map((arm) => arm.nextAt));
  await new Promise((resolve) => setTimeout(resolve, Math.max(250, Math.min(nextAt - Date.now(), deadline - Date.now()))));
}

for (const arm of arms.values()) {
  const sorted = [...arm.delays].sort((a, b) => a - b);
  console.log(JSON.stringify({
    event: 'summary',
    interval_seconds: arm.intervalMs / 1000,
    unique_projects_seen_after_baseline: arm.newProjects,
    median_delay_seconds: percentile(sorted, 0.5),
    p90_delay_seconds: percentile(sorted, 0.9),
    max_delay_seconds: sorted.length ? Number(sorted.at(-1).toFixed(3)) : null,
    api_calls: arm.calls,
    rate_limit_errors: arm.rateLimits,
    other_errors: arm.errors,
    delays_measured: sorted.length,
  }));
}
console.log(JSON.stringify({ event: 'spike_finished', finished_at: new Date().toISOString() }));
