const API_ROOT = 'https://www.freelancer.com/api/projects/0.1/projects';

function findProjects(payload, depth = 0) {
  if (depth > 8 || payload == null) return [];
  if (Array.isArray(payload)) {
    if (payload.some((item) => item && typeof item === 'object' && ('id' in item || 'project_id' in item))) return payload;
    for (const item of payload) {
      const nested = findProjects(item, depth + 1);
      if (nested.length) return nested;
    }
  } else if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (/projects?/i.test(key) && Array.isArray(value)) return value;
    }
    for (const value of Object.values(payload)) {
      const nested = findProjects(value, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

function findProject(payload, id) {
  const values = findProjects(payload);
  const exact = values.find((item) => String(item.id ?? item.project_id ?? '') === String(id));
  if (exact) return exact;
  if (payload && typeof payload === 'object') {
    if (String(payload.id ?? payload.project_id ?? '') === String(id)) return payload;
    for (const value of Object.values(payload)) {
      const nested = findProject(value, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

function parseTimestamp(value) {
  if (value == null) return new Date();
  const normalized = typeof value === 'number' || /^\d+$/.test(String(value))
    ? Number(value) * (Number(value) < 10_000_000_000 ? 1000 : 1)
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeBudget(value) {
  if (!value || typeof value !== 'object') return {};
  const min = Number(value.minimum ?? value.min ?? value.amount ?? value.value);
  const max = Number(value.maximum ?? value.max ?? value.amount ?? value.value);
  return {
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
    ...(typeof value.currency === 'string' ? { currency: value.currency } : typeof value.currency?.code === 'string' ? { currency: value.currency.code } : {}),
    ...(value.project_type === 'hourly' || value.type === 'hourly' ? { type: 'hourly' } : value.project_type || value.type ? { type: 'fixed' } : {}),
  };
}

function normalizeSkills(project) {
  const values = project.skills ?? project.jobs ?? project.job_names ?? [];
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((item) => clean(typeof item === 'string' ? item : item?.name ?? item?.title ?? item?.label)).filter(Boolean))];
}

function normalizeProject(project) {
  const id = String(project.id ?? project.project_id ?? '');
  const seo = project.seo_url ?? project.seoUrl;
  const url = typeof project.url === 'string' && /^https?:/.test(project.url)
    ? project.url
    : typeof seo === 'string' && /^https?:/.test(seo)
      ? seo
      : typeof seo === 'string' && seo
        ? `https://www.freelancer.com/projects/${seo.replace(/^\/+/, '')}`
        : `https://www.freelancer.com/projects/${encodeURIComponent(id)}`;
  return {
    platform: 'freelancer',
    externalId: id,
    title: clean(project.title ?? project.name),
    description: clean(project.description ?? project.preview_description),
    url,
    budget: normalizeBudget(project.budget),
    skills: normalizeSkills(project),
    postedAt: parseTimestamp(project.time_submitted ?? project.posted_at ?? project.created_at),
  };
}

async function apiGet(url, token) {
  const response = await fetch(url, {
    headers: { 'Freelancer-OAuth-V1': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = undefined; }
  return { status: response.status, url: response.url, payload };
}

export function createFreelancerSource(token) {
  if (!token) throw new Error('Set FREELANCER_OAUTH_TOKEN in the international runner environment.');
  return {
    id: 'freelancer',
    group: 'international',
    pollIntervalMs: 60_000,
    async fetchListing() {
      const url = `${API_ROOT}/active/?limit=50&sort_field=time_submitted&sort_direction=desc`;
      const response = await apiGet(url, token);
      const items = findProjects(response.payload).map(normalizeProject).filter((project) => project.externalId && project.title);
      return { ...response, projects: items, rowCount: items.length };
    },
    async fetchDetail(project) {
      const response = await apiGet(`${API_ROOT}/${encodeURIComponent(project.externalId)}/`, token);
      if (!response.payload) return { ...response, detail: undefined };
      const rawProject = findProject(response.payload, project.externalId);
      return { ...response, detail: rawProject ? normalizeProject(rawProject) : undefined, rawProject };
    },
  };
}
