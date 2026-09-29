import { load } from 'cheerio';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeDigits = (value) => value
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

function collectStructuredValues(value, found = { descriptions: [], skills: [], budgets: [] }, depth = 0) {
  if (depth > 12 || value == null) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredValues(item, found, depth + 1);
    return found;
  }
  if (typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (typeof item === 'string' && /^(description|projectdescription|projectbrief|details|longdescription)$/.test(normalizedKey) && clean(item).length > 30) found.descriptions.push(clean(item));
    if (/^(skills|requiredskills|skillnames|jobs)$/.test(normalizedKey) && Array.isArray(item)) {
      for (const skill of item) {
        const name = typeof skill === 'string' ? skill : skill && typeof skill === 'object' ? (skill.name ?? skill.title ?? skill.label) : '';
        if (clean(name)) found.skills.push(clean(name));
      }
    }
    if (/^(budget|projectbudget|price|amount)$/.test(normalizedKey) && (typeof item === 'number' || (item && typeof item === 'object'))) found.budgets.push(item);
    collectStructuredValues(item, found, depth + 1);
  }
  return found;
}

function parseBudgetText(text) {
  const normalized = normalizeDigits(text).replace(/,/g, '').replace(/\s+/g, ' ');
  const match = normalized.match(/(?:budget|الميزانية|ميزانية|المبلغ|السعر)[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:-|–|to|إلى)\s*(\d+(?:\.\d+)?)(?:\s*([A-Z]{3}|USD|EUR|GBP|SAR|ر\.س|جنيه|ج\.م|دولار))?/i)
    ?? normalized.match(/(?:budget|الميزانية|ميزانية|المبلغ|السعر)[^\d]{0,30}(\d+(?:\.\d+)?)(?:\s*([A-Z]{3}|USD|EUR|GBP|SAR|ر\.س|جنيه|ج\.م|دولار))?/i);
  if (!match) return undefined;
  const currencyText = match[3] ?? match[2] ?? '';
  const currency = /USD|\$|دولار/i.test(currencyText) ? 'USD'
    : /EUR|€/i.test(currencyText) ? 'EUR'
      : /GBP|£/i.test(currencyText) ? 'GBP'
        : /SAR|ر\.س/i.test(currencyText) ? 'SAR'
          : /جنيه|ج\.م/i.test(currencyText) ? 'EGP'
            : /^[A-Z]{3}$/.test(currencyText) ? currencyText : undefined;
  return { min: Number(match[1]), max: match[3] ? Number(match[2]) : Number(match[1]), currency };
}

export function parsePublicProjectDetail(html, listingProject = {}) {
  const $ = load(html);
  const main = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const pageText = clean(main.text()).slice(0, 80_000);
  const structured = { descriptions: [], skills: [], budgets: [] };

  $('script[type="application/ld+json"]').each((_index, node) => {
    try { collectStructuredValues(JSON.parse($(node).text()), structured); } catch { /* malformed JSON-LD is ignored */ }
  });
  $('script').each((_index, node) => {
    const text = $(node).text();
    if (!text || text.length > 2_000_000) return;
    const candidates = text.match(/\{[\s\S]{0,400000}\}/g) ?? [];
    for (const candidate of candidates.slice(0, 8)) {
      try { collectStructuredValues(JSON.parse(candidate), structured); } catch { /* framework scripts may not be plain JSON */ }
    }
  });

  const descriptionCandidates = [
    ...structured.descriptions,
    ...$('main [itemprop="description"], article [itemprop="description"], main [class*="project-description"], main [class*="description"], main [class*="prose"], article [class*="description"]')
      .toArray().map((node) => clean($(node).text())).filter((text) => text.length > 30),
    clean($('meta[property="og:description"]').attr('content')),
    clean($('meta[name="description"]').attr('content')),
  ];
  const listingDescription = clean(listingProject.description);
  const descriptionFull = descriptionCandidates
    .filter((text) => text && text.length >= listingDescription.length)
    .sort((a, b) => b.length - a.length)[0] ?? listingDescription;

  const skills = new Set(structured.skills);
  main.find('[class*="skill" i] a, [class*="skill" i] span, [class*="skills" i] a, [class*="skills" i] span, [itemprop="skills"]')
    .each((_index, node) => {
      const text = clean($(node).text());
      if (text && text.length <= 100 && !/[\n:：]/.test(text)) skills.add(text);
    });
  for (const skill of listingProject.skills ?? []) if (clean(skill)) skills.add(clean(skill));

  let budget;
  for (const item of structured.budgets) {
    if (typeof item === 'number') { budget = { min: item, max: item }; break; }
    if (item && typeof item === 'object') {
      const min = Number(item.minimum ?? item.min ?? item.budget_min ?? item.amount ?? item.value);
      const max = Number(item.maximum ?? item.max ?? item.budget_max ?? item.amount ?? item.value);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        budget = { min, max, currency: item.currency?.code ?? item.currency ?? item.currency_code };
        break;
      }
    }
  }
  budget ??= parseBudgetText(pageText);
  if (!budget && (listingProject.budgetMin != null || listingProject.budgetMax != null)) {
    budget = { min: listingProject.budgetMin, max: listingProject.budgetMax, currency: listingProject.currency };
  }

  return {
    description: descriptionFull,
    pageText,
    skills: [...skills],
    budget,
    fieldsFound: [
      ...(descriptionFull ? ['description'] : []),
      ...(budget ? ['budget'] : []),
      ...(skills.size ? ['skills'] : []),
      ...(pageText ? ['page_text'] : []),
    ],
  };
}

export async function fetchPublicProjectDetail(project, userAgent) {
  const projectUrl = new URL(project.url);
  if (!/^https?:$/.test(projectUrl.protocol)) throw new Error('Unsupported project URL scheme.');
  const response = await fetch(projectUrl, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, url: response.url, html: await response.text() };
}
