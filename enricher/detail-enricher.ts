import { load } from 'cheerio';
import type { NormalizedProject } from '../adapters/types.ts';
import { getAdapter } from '../adapters/index.ts';
import { http } from '../net/polite-http.ts';

const clean = (val: unknown): string => String(val ?? '').replace(/\s+/g, ' ').trim();

/**
 * Generic detail page parser for freelance marketplaces.
 * Extracts JSON-LD, meta tags, article text, and skill badges.
 */
export function parseGenericDetailHtml(
  html: string,
  project: NormalizedProject,
): Partial<NormalizedProject> {
  const $ = load(html);

  // 1. Meta / OpenGraph descriptions
  const metaDesc = clean($('meta[name="description"]').attr('content'));
  const ogDesc = clean($('meta[property="og:description"]').attr('content'));

  // 2. Structured JSON-LD
  let jsonLdDesc = '';
  const jsonLdSkills: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const scan = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(scan);
          return;
        }
        const record = obj as Record<string, unknown>;
        if (record.description && typeof record.description === 'string' && record.description.length > 40) {
          jsonLdDesc = clean(record.description);
        }
        if (Array.isArray(record.skills)) {
          record.skills.forEach((s) => {
            if (typeof s === 'string' && clean(s)) jsonLdSkills.push(clean(s));
          });
        }
        Object.values(record).forEach(scan);
      };
      scan(data);
    } catch {
      // Ignore invalid JSON-LD
    }
  });

  // 3. Main article / body description
  const bodyCandidates = [
    $('article').first().text(),
    $('main').first().text(),
    $('[itemprop="description"]').first().text(),
    $('[class*="project-description"], [class*="job-description"], [class*="description"], [class*="prose"]')
      .first()
      .text(),
  ].map(clean).filter((t) => t.length > 40);

  const descCandidates = [jsonLdDesc, ogDesc, metaDesc, ...bodyCandidates, project.description]
    .filter((t) => t && t.length > 20);
  descCandidates.sort((a, b) => b.length - a.length);
  const bestDescription = descCandidates[0] || project.description;

  // 4. Skills extraction
  const extractedSkills = new Set<string>(project.skills);
  jsonLdSkills.forEach((s) => extractedSkills.add(s));

  $('a[href*="/skill/"], a[href*="/skills/"], .tag, .badge, [class*="skill"]')
    .toArray()
    .forEach((el) => {
      const txt = clean($(el).text());
      if (txt && txt.length > 1 && txt.length < 50 && !/^\d+$/.test(txt)) {
        extractedSkills.add(txt);
      }
    });

  return {
    description: bestDescription,
    skills: [...extractedSkills],
    detailsEnriched: true,
  };
}

/**
 * Enriches a project with full description, skills, and budget by scraping its project URL.
 *
 * Every request goes through the polite HTTP client (robots.txt, pacing, backoff). A project that
 * cannot be enriched (blocked, disallowed, timeout) is simply kept as-is with detailsEnriched=false.
 */
export async function enrichProjectDetails(
  project: NormalizedProject,
  timeoutMs = 15_000,
): Promise<NormalizedProject> {
  // Freelancer.com data comes from the official API (already includes the full description and skills).
  // Never fall back to scraping the website for it.
  if (project.platform === 'freelancer') return project;

  // Already complete.
  if (project.detailsEnriched && project.description.length > 100 && project.skills.length > 0) {
    return project;
  }

  // A platform-specific enricher is authoritative. If it could not enrich (blocked, 4xx, timeout),
  // do NOT immediately re-request the same URL with the generic fallback: that doubled the request
  // volume exactly when a site was already pushing back.
  const adapter = getAdapter(project.platform);
  if (adapter?.enrichProject) {
    try {
      return await adapter.enrichProject(project);
    } catch {
      return project;
    }
  }

  // Generic fallback only for adapters without their own enricher.
  if (!project.url) return project;

  try {
    const res = await http.get(project.url, { timeoutMs });
    if (!res.ok) return project;

    const html = await res.text();
    const partial = parseGenericDetailHtml(html, project);

    return {
      ...project,
      ...partial,
      listingDescription: project.listingDescription || project.description,
      detailsEnriched: true,
    };
  } catch {
    return project;
  }
}
