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
    .replace(/>/g, '&gt;');
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

  const rawDesc = project.listingDescription || project.description || '';
  const cleanDesc = rawDesc.replace(/\s+/g, ' ').trim();
  const descSnippet = cleanDesc.length > 250
    ? escapeHtml(cleanDesc.slice(0, 250)) + '…'
    : escapeHtml(cleanDesc);

  const lines = [
    `🎯 <b>NEW MATCH DETECTED!</b> (Score: <b>+${match.score}</b>)`,
    ``,
    `💼 <b>Platform:</b> ${platformName}`,
    `📌 <b>Title:</b> <a href="${url}">${title}</a>`,
    `💰 <b>Budget:</b> ${budget}`,
    `🏷️ <b>Keywords:</b> ${escapeHtml(matches)}`,
    ``,
    `📝 <b>Summary:</b>`,
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
  const token = config?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = config?.chatId || process.env.TELEGRAM_CHAT_ID;

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

  const text = formatProjectMessage(project, match, proposal);

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
      } else {
        console.error(`[Telegram] Error sending message:`, detail);
      }
      return { ok: false, error: detail };
    }

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Network error sending alert:`, msg);
    return { ok: false, error: msg };
  }
}
