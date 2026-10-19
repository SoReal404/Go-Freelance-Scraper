/**
 * End-to-end smoke test for the GO Freelance worker.
 *
 * Checks every layer of the stack in order:
 *   1. Environment variables present
 *   2. Supabase connectivity (if configured)
 *   3. Gemini API (if configured)
 *   4. OpenAI API (if configured)
 *   5. Proposal generation (AI or smart-template fallback)
 *   6. Matcher pipeline with a realistic fake project
 *   7. Telegram – full formatted alert with proposal (sends real message)
 *
 * Usage (on EC2 or locally):
 *   npm run smoke          ← full test, sends real Telegram message
 *   npm run smoke -- --dry ← skips Telegram send
 *
 * Exit code 0 = all checks passed, non-zero = at least one failed.
 */

// ─── Load .env ──────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');

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

// ─── Imports (after env loaded) ─────────────────────────────────────────────
import { evaluateProject } from '../alerts/matcher.ts';
import { generateProposal, generateSmartTemplate } from '../alerts/bid-generator.ts';
import { sendTelegramAlert, formatProjectMessage } from '../alerts/telegram.ts';
import type { NormalizedProject } from '../adapters/types.ts';

// ─── Helpers ────────────────────────────────────────────────────────────────
const DRY = process.argv.includes('--dry');
const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const SKIP = '\x1b[33m–\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

let failures = 0;

function pass(label: string, detail = '') {
  console.log(`  ${PASS} ${label}${detail ? `  \x1b[2m(${detail})\x1b[0m` : ''}`);
}
function fail(label: string, detail = '') {
  failures++;
  console.log(`  ${FAIL} \x1b[1m${label}\x1b[0m${detail ? `  \x1b[31m${detail}\x1b[0m` : ''}`);
}
function skip(label: string, reason = '') {
  console.log(`  ${SKIP} ${label}${reason ? `  \x1b[2m(${reason})\x1b[0m` : ''}`);
}
function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ─── Fake project (realistic n8n / automation match) ────────────────────────
const FAKE_PROJECT: NormalizedProject = {
  platform: 'freelancer',
  externalId: 'smoke-test-9999',
  title: 'Build an n8n automation workflow with WhatsApp Business API & OpenAI GPT',
  description:
    'We need an n8n workflow that listens for incoming WhatsApp messages via the WhatsApp Business Cloud API, ' +
    'sends them to ChatGPT (OpenAI), and replies automatically. The bot should also log conversations to a ' +
    'Google Sheet via a webhook. Budget is flexible. Python FastAPI micro-service for the webhook is a plus.',
  url: 'https://www.freelancer.com/projects/smoke-test',
  budgetMin: 150,
  budgetMax: 400,
  currency: 'USD',
  budgetType: 'fixed',
  skills: ['n8n', 'whatsapp-api', 'openai', 'python', 'fastapi'],
  language: 'en',
  postedAt: new Date(),
  firstSeenAt: new Date(),
  detailsEnriched: false,
};

// ─── 1. Environment Variables ────────────────────────────────────────────────
section('1 · Environment Variables');

const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const OPTIONAL_AI = ['GEMINI_API_KEY', 'OPENAI_API_KEY'];

for (const v of REQUIRED) {
  if (process.env[v]) pass(v);
  else fail(v, 'required – add to .env');
}
for (const v of OPTIONAL_AI) {
  if (process.env[v]) pass(v, 'AI proposals enabled');
  else skip(v, 'not set – will use smart-template fallback');
}

// ─── 2. Supabase ─────────────────────────────────────────────────────────────
section('2 · Supabase Connectivity');

const supaUrl = process.env.SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supaUrl || !supaKey) {
  skip('Supabase', 'SUPABASE_URL / key not set – DB sync disabled');
} else {
  try {
    const res = await fetch(`${supaUrl}/rest/v1/projects?limit=1`, {
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok || res.status === 406) {
      pass('Supabase REST API reachable', `HTTP ${res.status}`);
    } else {
      const txt = await res.text();
      fail('Supabase REST API', `HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }
  } catch (e: any) {
    fail('Supabase REST API', e.message);
  }
}

// ─── 3. Gemini API ────────────────────────────────────────────────────────────
section('3 · Gemini API');

const geminiKey = process.env.GEMINI_API_KEY?.trim();
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!geminiKey) {
  skip('Gemini', 'GEMINI_API_KEY not set');
} else {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK' }] }] }),
      },
    );
    clearTimeout(t);
    const data: any = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
    if (!res.ok || !reply) {
      fail(`Gemini (${geminiModel})`, data.error?.message || `HTTP ${res.status}`);
    } else {
      pass(`Gemini (${geminiModel})`, `replied: "${reply.slice(0, 40)}"`);
    }
  } catch (e: any) {
    fail('Gemini API', e.message);
  }
}

// ─── 4. OpenAI API ────────────────────────────────────────────────────────────
section('4 · OpenAI API');

const openaiKey = process.env.OPENAI_API_KEY?.trim();
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!openaiKey) {
  skip('OpenAI', 'OPENAI_API_KEY not set');
} else {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: openaiModel,
        messages: [{ role: 'user', content: 'Reply with the single word OK' }],
        max_tokens: 5,
      }),
    });
    clearTimeout(t);
    const data: any = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !reply) {
      fail(`OpenAI (${openaiModel})`, data.error?.message || `HTTP ${res.status}`);
    } else {
      pass(`OpenAI (${openaiModel})`, `replied: "${reply.slice(0, 40)}"`);
    }
  } catch (e: any) {
    fail('OpenAI API', e.message);
  }
}

// ─── 5. Matcher pipeline ─────────────────────────────────────────────────────
section('5 · Matcher Pipeline');

const matchResult = evaluateProject(FAKE_PROJECT, {
  minScore: Number(process.env.MIN_MATCH_SCORE) || 4,
  minBudgetUsd: Number(process.env.MIN_PROJECT_BUDGET) || 15,
});

if (!matchResult.matched) {
  fail('Fake project should match', `score=${matchResult.score}, excluded=${matchResult.excludedBy ?? 'no'}`);
} else {
  pass(`Match score: +${matchResult.score}`, [
    matchResult.strongMatches.map((k) => `⭐${k}`).join(' '),
    matchResult.mediumMatches.map((k) => `🔹${k}`).join(' '),
    matchResult.weakMatches.map((k) => `▫️${k}`).join(' '),
  ].filter(Boolean).join(' | '));
}

// ─── 6. Proposal Generation ──────────────────────────────────────────────────
section('6 · Proposal Generation');

let proposal = '';
try {
  proposal = await generateProposal(FAKE_PROJECT, matchResult);
  const isTemplate = proposal.startsWith('Hi there,') || proposal.startsWith('السلام');
  pass(
    isTemplate ? 'Smart-template fallback used' : 'AI-generated proposal',
    `${proposal.length} chars`,
  );
  console.log(`\n  ${INFO} Preview (first 200 chars):`);
  console.log(`  \x1b[2m${proposal.slice(0, 200).replace(/\n/g, '\n  ')}…\x1b[0m\n`);
} catch (e: any) {
  fail('Proposal generation threw', e.message);
  proposal = generateSmartTemplate(FAKE_PROJECT, matchResult);
}

// ─── 7. Telegram ─────────────────────────────────────────────────────────────
section('7 · Telegram Full Alert');

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!botToken || !chatId) {
  fail('Telegram credentials missing', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
} else if (DRY) {
  const msg = formatProjectMessage(FAKE_PROJECT, matchResult, proposal);
  skip('Telegram send skipped (--dry flag)', `message would be ${msg.length} chars`);
  console.log(`\n  ${INFO} Full formatted message:\n`);
  console.log(msg.split('\n').map((l) => `  ${l}`).join('\n'));
} else {
  // Prepend a clear smoke-test banner so you know it's not a real match
  const banner = `🧪 <b>[SMOKE TEST – ignore this message]</b>\n`;
  const body = formatProjectMessage(FAKE_PROJECT, matchResult, proposal);
  const text = banner + body;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data: any = await res.json();
    if (data.ok) {
      pass('Telegram message sent', `message_id=${data.result.message_id}`);
    } else {
      fail('Telegram send failed', data.description || `error_code=${data.error_code}`);
    }
  } catch (e: any) {
    fail('Telegram network error', e.message);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
if (failures === 0) {
  console.log(`\x1b[32m\x1b[1m✔ All checks passed!\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m✘ ${failures} check(s) failed – see above.\x1b[0m`);
}
console.log('─'.repeat(50) + '\n');

process.exit(failures > 0 ? 1 : 0);
// Note: process.exit() is called explicitly to avoid the libuv handle-closing
// assertion that fires on some Windows builds when using top-level await + fetch.
