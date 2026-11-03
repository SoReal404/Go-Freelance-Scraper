/**
 * Export all collected projects to CSV and generate a Markdown summary report.
 *
 * Sources:
 * 1. Local JSON store (`data/projects.json`)
 * 2. If local store is empty and Supabase is configured, pulls projects from Supabase.
 *
 * Output:
 * - `projects.csv`: Full spreadsheet of all projects
 * - `PROJECTS_SUMMARY.md`: Clean Markdown report with counts per platform, budget stats, and skills
 *
 * Usage:
 *   npm run export
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { defaultStore } from '../storage/project-store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

// Load environment variables if present
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

interface ProjectRecord {
  platform: string;
  external_id: string;
  title: string;
  description: string;
  url: string;
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string | null;
  budget_type?: string | null;
  skills: string[];
  category?: string | null;
  language?: string | null;
  posted_at?: string | null;
  details_enriched?: boolean;
}

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
  return `"${str.replace(/"/g, '""')}"`;
}

async function fetchFromSupabase(): Promise<ProjectRecord[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  console.log('📡 Fetching all projects from Supabase cloud...');
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const allRows: any[] = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('posted_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.warn('⚠️ Supabase fetch warning:', error.message);
        break;
      }

      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return allRows.map((row: any) => ({
      platform: row.platform,
      external_id: row.external_id,
      title: row.title,
      description: row.description || row.listing_desc || '',
      url: row.url,
      budget_min: row.budget_min,
      budget_max: row.budget_max,
      currency: row.currency,
      budget_type: row.budget_type,
      skills: Array.isArray(row.skills) ? row.skills : [],
      category: row.category,
      language: row.language,
      posted_at: row.posted_at,
      details_enriched: row.details_enriched,
    }));
  } catch (err: any) {
    console.warn('⚠️ Failed to connect to Supabase:', err.message);
    return [];
  }
}

async function main() {
  console.log('\n🔍 Reading collected projects...');

  // 1. Try reading from local JSON store
  await defaultStore.init();
  const localProjects = await defaultStore.readAll();
  console.log(`📦 Found ${localProjects.length} projects in local JSON storage.`);

  let allProjects: ProjectRecord[] = localProjects.map((p) => ({
    platform: p.platform,
    external_id: p.external_id,
    title: p.title,
    description: p.description || p.listing_description || '',
    url: p.project_url,
    budget_min: p.budget.min,
    budget_max: p.budget.max,
    currency: p.budget.currency,
    budget_type: p.budget.type,
    skills: p.skills || [],
    category: p.category,
    language: p.language,
    posted_at: p.posted_at,
    details_enriched: p.details_enriched,
  }));

  // 2. If local store has no or few projects, pull from Supabase
  if (allProjects.length === 0) {
    const cloudProjects = await fetchFromSupabase();
    if (cloudProjects.length > 0) {
      console.log(`☁️ Retrieved ${cloudProjects.length} projects from Supabase.`);
      allProjects = cloudProjects;
    }
  }

  if (allProjects.length === 0) {
    console.log('\n⚠️ No projects found locally or in Supabase.');
    console.log('Run the scraper first (or check that your Supabase connection has data).\n');
    return;
  }

  // 3. Build CSV content
  const headers = [
    'Platform',
    'External ID',
    'Title',
    'Budget Min',
    'Budget Max',
    'Currency',
    'Budget Type',
    'Skills',
    'Category',
    'Language',
    'Posted At',
    'Enriched',
    'URL',
    'Description',
  ];

  const csvRows = [headers.join(',')];

  for (const p of allProjects) {
    csvRows.push(
      [
        escapeCsv(p.platform),
        escapeCsv(p.external_id),
        escapeCsv(p.title),
        escapeCsv(p.budget_min ?? ''),
        escapeCsv(p.budget_max ?? ''),
        escapeCsv(p.currency ?? ''),
        escapeCsv(p.budget_type ?? ''),
        escapeCsv((p.skills || []).join('; ')),
        escapeCsv(p.category ?? ''),
        escapeCsv(p.language ?? 'en'),
        escapeCsv(p.posted_at ?? ''),
        escapeCsv(p.details_enriched ? 'Yes' : 'No'),
        escapeCsv(p.url),
        escapeCsv(p.description),
      ].join(','),
    );
  }

  const csvPath = resolve(__dirname, '..', 'projects.csv');
  await writeFile(csvPath, '\uFEFF' + csvRows.join('\n'), 'utf8'); // BOM for Excel UTF-8 support
  console.log(`✅ Saved ${allProjects.length} projects to: ${csvPath}`);

  // 4. Build Markdown Summary
  const byPlatform: Record<
    string,
    { total: number; fixed: number; hourly: number; other: number; oldest: string; newest: string }
  > = {};
  const skillCount: Record<string, number> = {};

  for (const p of allProjects) {
    // Platform breakdown
    const plat = p.platform.toUpperCase();
    if (!byPlatform[plat]) {
      byPlatform[plat] = {
        total: 0,
        fixed: 0,
        hourly: 0,
        other: 0,
        oldest: p.posted_at || '',
        newest: p.posted_at || '',
      };
    }
    const stat = byPlatform[plat];
    stat.total++;
    if (p.budget_type === 'fixed') stat.fixed++;
    else if (p.budget_type === 'hourly') stat.hourly++;
    else stat.other++;

    if (p.posted_at) {
      if (!stat.oldest || p.posted_at < stat.oldest) stat.oldest = p.posted_at;
      if (!stat.newest || p.posted_at > stat.newest) stat.newest = p.posted_at;
    }

    // Skills tally
    for (const s of p.skills || []) {
      const normalized = s.trim().toLowerCase();
      if (normalized) {
        skillCount[normalized] = (skillCount[normalized] || 0) + 1;
      }
    }
  }

  // Top 15 skills
  const topSkills = Object.entries(skillCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const enrichedCount = allProjects.filter((p) => p.details_enriched).length;
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const mdLines = [
    `# 📊 GO Freelance Projects Summary Report`,
    ``,
    `*Generated on: \`${nowStr}\`*`,
    ``,
    `---`,
    ``,
    `## 📈 Overview`,
    ``,
    `- **Total Projects Collected:** \`${allProjects.length}\``,
    `- **Fully Enriched (with details):** \`${enrichedCount}\` (${Math.round((enrichedCount / allProjects.length) * 100)}%)`,
    `- **Active Platforms:** \`${Object.keys(byPlatform).length}\``,
    `- **CSV Export:** [\`projects.csv\`](./projects.csv)`,
    ``,
    `---`,
    ``,
    `## 🏢 Breakdown by Platform`,
    ``,
    `| Platform | Total Projects | Fixed Budget | Hourly Budget | Other / Negotiable | Share |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: |`,
  ];

  for (const [plat, s] of Object.entries(byPlatform)) {
    const pct = ((s.total / allProjects.length) * 100).toFixed(1);
    mdLines.push(`| **${plat}** | \`${s.total}\` | ${s.fixed} | ${s.hourly} | ${s.other} | ${pct}% |`);
  }

  mdLines.push(
    `| **TOTAL** | **\`${allProjects.length}\`** | **${allProjects.filter((p) => p.budget_type === 'fixed').length}** | **${allProjects.filter((p) => p.budget_type === 'hourly').length}** | **${allProjects.filter((p) => !p.budget_type || (p.budget_type !== 'fixed' && p.budget_type !== 'hourly')).length}** | **100%** |`,
  );

  mdLines.push(
    ``,
    `---`,
    ``,
    `## 🔥 Top 15 In-Demand Skills`,
    ``,
    `| Skill / Keyword | Projects Tagged |`,
    `| :--- | :---: |`,
  );

  for (const [skill, count] of topSkills) {
    mdLines.push(`| \`${skill}\` | **${count}** |`);
  }

  mdLines.push(
    ``,
    `---`,
    ``,
    `### 💡 Notes & Tips`,
    `- Open \`projects.csv\` directly in **Excel**, **Google Sheets**, or **VS Code**. UTF-8 encoding (BOM) is included so Arabic and special characters display properly.`,
    `- To fetch fresh projects from all platforms, run \`npm run scrape\` locally or leave your server PM2 worker running.`,
  );

  const mdPath = resolve(__dirname, '..', 'PROJECTS_SUMMARY.md');
  await writeFile(mdPath, mdLines.join('\n'), 'utf8');
  console.log(`✅ Saved Markdown summary report to: ${mdPath}`);

  console.log('\n📊 Platform Counts Summary:');
  for (const [plat, s] of Object.entries(byPlatform)) {
    console.log(`   • ${plat.padEnd(16)}: ${s.total} projects`);
  }
  console.log(`\n🎉 Export completed successfully!\n`);
}

main().catch((err) => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});
