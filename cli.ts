try { process.loadEnvFile(); } catch { /* ignore if .env missing */ }

import { allAdapters, getAdapter, getAdaptersByRegion } from './adapters/index.ts';
import type { PlatformId } from './adapters/index.ts';
import { ScraperEngine } from './engine.ts';
import { defaultStore, fromStoredProject } from './storage/project-store.ts';
import { upsertProjectsBatch, deleteProjectsOlderThan } from './storage/supabase-store.ts';

function printHelp() {
  console.log(`
========================================================================
                      GO FREELANCE SCRAPER CLI
========================================================================

Usage:
  node --experimental-strip-types cli.ts [options]

Options:
  --health                Check connectivity & health of all platforms
  --region=<name>         Filter platforms: all | middle-east | international (default: all)
  --platforms=<p1,p2>     Comma-separated platform IDs to scrape
                          Available: freelancer, peopleperhour,
                                     mostaql, nafezly, shoghlonline, freelance-arabs
  --once                  Run one scrape cycle, enrich new projects, and exit
  --watch                 Run continuously in real-time monitoring mode
  --no-enrich             Do not fetch project detail pages (scrape listings only)
  --stats                 Print summary of collected projects in storage
  --sync                  Push every project in the local JSON store to Supabase (backfill / recovery)
  --cleanup               Delete projects older than 3 days (or --max-age-days=N) from DB & local store
  --max-age-days=<days>   Configure cutoff age in days for cleanup (default: 3)
  --help                  Show this help screen

Environment Variables:
  FREELANCER_OAUTH_TOKEN  OAuth token for the Freelancer.com API (required, no default)
  SCRAPER_CONTACT         Email or URL put in the User-Agent so sites can reach you
  SCRAPE_POLL_SECONDS     Poll interval for scraped sites (default 300, minimum 120)
  MIN_REQUEST_GAP_MS      Minimum gap between requests to the same host (default 3000)
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Database sync (server-side key, never the anon key)

Examples:
  # Check health of all platforms:
  node --experimental-strip-types cli.ts --health

  # Run one scrape pass across all platforms:
  node --experimental-strip-types cli.ts --once

  # Scrape only international platforms (Freelancer & PeoplePerHour):
  node --experimental-strip-types cli.ts --region=international --once

  # Scrape specific platforms:
  node --experimental-strip-types cli.ts --platforms=freelancer,peopleperhour,mostaql,nafezly --once

  # Continuous real-time monitoring:
  node --experimental-strip-types cli.ts --watch
========================================================================
`);
}

async function runHealthCheck(adapters = allAdapters) {
  console.log('\n🔍 Running health checks across platforms...\n');
  console.log('| Platform | Region | Status | Details |');
  console.log('| :--- | :--- | :---: | :--- |');

  for (const adapter of adapters) {
    const started = Date.now();
    try {
      const result = await adapter.healthCheck();
      const elapsed = Date.now() - started;
      const statusIcon = result.ok ? '✅ OK' : '⚠️ WARN';
      console.log(`| **${adapter.name}** (\`${adapter.id}\`) | ${adapter.region} | ${statusIcon} | ${result.detail || 'Healthy'} (${elapsed}ms) |`);
    } catch (err: any) {
      console.log(`| **${adapter.name}** (\`${adapter.id}\`) | ${adapter.region} | ❌ ERR | ${err.message} |`);
    }
  }
  console.log('');
}

async function runStats() {
  await defaultStore.init();
  const stats = await defaultStore.getStats();
  console.log('\n📊 Project Store Statistics:');
  console.log(`Total Projects Saved: ${stats.total}`);
  console.log(`Fully Enriched with Description/Skills: ${stats.enrichedCount}`);
  console.log('Breakdown by Platform:');
  for (const [platform, count] of Object.entries(stats.byPlatform)) {
    console.log(`  - ${platform}: ${count}`);
  }
  console.log('');
}

async function runSync() {
  const stored = await defaultStore.readAll();
  console.log(`\n🔄 Pushing ${stored.length} locally stored projects to Supabase...`);
  const result = await upsertProjectsBatch(stored.map(fromStoredProject));
  if (result.skipped) {
    console.log('   Supabase is not configured (SUPABASE_URL / key missing). Nothing was sent.\n');
    return;
  }
  console.log(`   Synced: ${result.ok}   Failed: ${result.failed}\n`);
  if (result.failed) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printHelp();
    return;
  }

  if (args.includes('--stats')) {
    await runStats();
    return;
  }

  if (args.includes('--sync')) {
    await runSync();
    return;
  }

  const maxAgeArg = args.find((a) => a.startsWith('--max-age-days='));
  const maxProjectAgeDays = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : 3;

  if (args.includes('--cleanup')) {
    console.log(`\n🧹 Cleaning up projects older than ${maxProjectAgeDays} days...`);
    const db = await deleteProjectsOlderThan(maxProjectAgeDays);
    const local = await defaultStore.pruneOlderThan(maxProjectAgeDays);
    console.log(`   Deleted from Supabase: ${db.deleted} ${db.error ? `(warning: ${db.error})` : ''}`);
    console.log(`   Pruned from local store: ${local}\n`);
    return;
  }

  // Parse region filter
  let selectedAdapters = allAdapters;
  const regionArg = args.find((a) => a.startsWith('--region='));
  if (regionArg) {
    const region = regionArg.split('=')[1].trim() as any;
    if (region === 'middle-east' || region === 'international') {
      selectedAdapters = getAdaptersByRegion(region);
    }
  }

  // Parse platforms filter
  const platformsArg = args.find((a) => a.startsWith('--platforms='));
  if (platformsArg) {
    const requested = platformsArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim() as PlatformId);
    selectedAdapters = requested
      .map((id) => getAdapter(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));
  }

  if (args.includes('--health')) {
    await runHealthCheck(selectedAdapters);
    return;
  }

  const enrichDetails = !args.includes('--no-enrich');
  const watch = args.includes('--watch');
  const once = args.includes('--once') || !watch;

  console.log(`\n🚀 Initializing Go Freelance Engine...`);
  console.log(`   Configured platforms (${selectedAdapters.length}): ${selectedAdapters.map((a) => a.id).join(', ')}`);
  console.log(`   Detail enrichment (full descriptions/skills/budgets): ${enrichDetails ? 'Enabled' : 'Disabled'}`);
  console.log(`   Retention policy: Automatically deletes projects older than ${maxProjectAgeDays} days`);
  console.log(`   Mode: ${watch ? 'Continuous Watch' : 'Single Pass (--once)'}\n`);

  const engine = new ScraperEngine({
    adapters: selectedAdapters,
    enrichDetails,
    maxProjectAgeDays,
    onLog: (ev) => {
      const time = new Date().toLocaleTimeString();
      if (ev.event === 'new_project_detected') {
        console.log(`[${time}] 🌟 NEW PROJECT [${ev.platform}] ${ev.title}`);
        console.log(`           URL: ${ev.url}`);
      } else if (ev.event === 'poll_success') {
        console.log(`[${time}] 📥 Polled ${ev.name}: ${ev.projects_fetched} active listings`);
      } else if (ev.event === 'poll_error') {
        console.log(`[${time}] ⚠️  Poll warning [${ev.platform}]: ${ev.error}`);
      } else if (ev.event === 'cleanup_completed') {
        console.log(`[${time}] 🧹 CLEANUP: pruned projects older than ${ev.max_age_days} days (Supabase: ${ev.supabase_deleted}, Local store: ${ev.local_pruned})`);
      } else if (ev.event === 'supabase_sync_failed' || ev.event === 'supabase_sync_retry') {
        console.log(`[${time}] 🗄️  ${ev.event}: ${JSON.stringify(ev)}`);
      }
    },
  });

  if (once) {
    const summary = await engine.runSingleCycle();
    console.log('\n========================================================================');
    console.log('✅ Cycle Finished Summary:');
    console.log(`   Platforms Polled: ${summary.polledAdapters}`);
    console.log(`   New Projects Added: ${summary.newProjectsFound}`);
    console.log(`   Enriched with Full Details: ${summary.enrichedCount}`);
    if (summary.errors.length) {
      console.log(`   Platform Warnings: ${summary.errors.length}`);
      for (const err of summary.errors) {
        console.log(`     - [${err.platform}]: ${err.error}`);
      }
    }
    console.log('========================================================================\n');
    await runStats();
  } else if (watch) {
    const abort = new AbortController();
    // SIGTERM is what systemd, Docker and pm2 send on stop/restart; SIGINT is Ctrl+C.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        console.log(`\n🛑 ${signal} received, stopping scraper engine...`);
        engine.stop();
        abort.abort();
      });
    }
    await engine.startMonitoring(abort.signal);
  }
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
