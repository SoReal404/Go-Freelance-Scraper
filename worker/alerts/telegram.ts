import type { NormalizedProject } from '../adapters/types.ts';
import type { MatchResult } from './matcher.ts';
import { generateProposal } from './bid-generator.ts';

export interface TelegramConfig {
  botToken?: string;
  chatId?: string | number;
  proposal?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Backticks confuse Telegram's parser even inside HTML-mode <pre><code> blocks
    .replace(/`/g, '&#96;');
}

/** Trim a message to Telegram's 4096-char hard limit, adding ellipsis if needed. */
function truncateIfNeeded(text: string, limit = 4000): string {
  return text.length > limit ? text.slice(0, limit) + '\n…' : text;
}

function formatBudget(p: NormalizedProject): string {
  if (p.budgetMin == null && p.budgetMax == null) return 'Not specified / Negotiable';
  const cur = p.currency || '$';
  const type = p.budgetType ? ` (${p.budgetType})` : '';
  if (p.budgetMin != null && p.budgetMax != null && p.budgetMin !== p.budgetMax) {
    return `${cur}${p.budgetMin} – ${cur}${p.budgetMax}${type}`;
  }
  const amt = p.budgetMin ?? p.budgetMax;
  return `${cur}${amt}${type}`;
}

export function formatProjectMessage(
  project: NormalizedProject,
  match: MatchResult,
  proposal?: string,
): string {
  const platformName = project.platform.toUpperCase();
  const title = escapeHtml(project.title);
  const budget = formatBudget(project);
  const url = project.url;

  const matches = [
    ...match.strongMatches.map((k) => `⭐ ${k}`),
    ...match.mediumMatches.map((k) => `🔹 ${k}`),
    ...match.weakMatches.map((k) => `▫️ ${k}`),
  ].join(' | ');

  // Detail enrichment populates description; prefer it over the shortened listing preview.
  const rawDesc = project.description || project.listingDescription || '';
  const cleanDesc = rawDesc.replace(/\s+/g, ' ').trim();
  const descriptionLimit = match.matched ? 250 : 2300;
  const descSnippet = cleanDesc.length > descriptionLimit
    ? escapeHtml(cleanDesc.slice(0, descriptionLimit)) + '…'
    : escapeHtml(cleanDesc);
  const skills = project.skills?.length ? project.skills.join(', ') : 'Not listed';
  const category = [project.category, project.subCategory].filter(Boolean).join(' › ');

  const lines = [
    match.matched
      ? `🎯 <b>NEW MATCH DETECTED!</b> (Score: <b>+${match.score}</b>)`
      : `🆕 <b>NEW PROJECT DETECTED</b>`,
    ``,
    `💼 <b>Platform:</b> ${platformName}`,
    `📌 <b>Title:</b> <a href="${escapeHtml(url)}">${title}</a>`,
    `💰 <b>Budget:</b> ${escapeHtml(budget)}`,
    `🧩 <b>Skills:</b> ${escapeHtml(skills.slice(0, 700))}${skills.length > 700 ? '…' : ''}`,
    ...(category ? [`🗂️ <b>Category:</b> ${escapeHtml(category)}`] : []),
    ...(match.matched ? [`🏷️ <b>Matching keywords:</b> ${escapeHtml(matches)}`] : []),
    ``,
    `📝 <b>Description:</b>`,
    `<i>${descSnippet || 'No description provided.'}</i>`,
  ];

  if (proposal?.trim()) {
    lines.push(
      ``,
      `📋 <b>AI Bid Proposal (Tap box to copy):</b>`,
      `<pre><code>${escapeHtml(proposal.trim())}</code></pre>`,
    );
  }

  lines.push(
    ``,
    `🔗 <a href="${url}"><b>Click here to view & apply on ${platformName} ↗</b></a>`,
  );

  return lines.join('\n');
}

export async function sendTelegramAlert(
  project: NormalizedProject,
  match: MatchResult,
  config?: TelegramConfig,
): Promise<{ ok: boolean; error?: string }> {
  const token = (config?.botToken || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  const chatId = (config?.chatId || process.env.TELEGRAM_CHAT_ID)?.toString().trim();

  if (!token || !chatId) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.' };
  }

  let proposal = config?.proposal;
  if (proposal === undefined) {
    try {
      proposal = await generateProposal(project, match);
    } catch (err: any) {
      console.warn(`[Telegram] Proposal generation warning: ${err.message}`);
    }
  }

  const text = truncateIfNeeded(formatProjectMessage(project, match, proposal));

  // Retry up to 3 times on transient 5xx errors (e.g. 502 Bad Gateway)
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      const data: any = await res.json();
      if (!data.ok) {
        const detail = data.description || 'Unknown Telegram API error';
        if (data.error_code === 400 && detail.includes('chat not found')) {
          console.warn(`\n⚠️  [Telegram] Chat not found! You must open https://t.me/GoFreelance_2_Bot and click /start first.\n`);
          return { ok: false, error: detail };
        }

        // If it's a 502/503/504 Bad Gateway / Server error, retry before giving up
        if (data.error_code >= 500 && attempt < maxAttempts) {
          console.warn(`[Telegram] ${detail} (${data.error_code}), retrying attempt ${attempt + 1}/${maxAttempts} in 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        console.error(`[Telegram] Error sending message:`, detail);
        return { ok: false, error: detail };
      }

      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        console.warn(`[Telegram] Network error (${msg}), retrying attempt ${attempt + 1}/${maxAttempts} in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error(`[Telegram] Network error sending alert:`, msg);
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: 'Telegram send failed after retries' };
}
