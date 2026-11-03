import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, containsKeyword, evaluateProject } from './matcher.ts';
import type { NormalizedProject } from '../adapters/types.ts';

const baseProject = (over: Partial<NormalizedProject> = {}): NormalizedProject => ({
  platform: 'mostaql',
  externalId: '100',
  title: 'Test project',
  description: 'Project description',
  url: 'https://mostaql.com/project/100',
  skills: [],
  postedAt: new Date(),
  ...over,
});

test('normalizeText normalizes Arabic alef, taa marbuta, yaa, and strips tashkeel/tatweel', () => {
  assert.equal(normalizeText('أَتْمَتَةُ الْعَمَلِيَّاتِ'), 'اتمته العمليات');
  assert.equal(normalizeText('أتــــمتة'), 'اتمته');
  assert.equal(normalizeText('إدارة آليّة'), 'اداره اليه');
  assert.equal(normalizeText('تعلّم الآلة'), 'تعلم الاله');
});

test('containsKeyword matches short words with word boundaries and avoids substring false positives', () => {
  // English short terms
  assert.equal(containsKeyword(normalizeText('We need a Stripe API connection'), 'api'), true);
  assert.equal(containsKeyword(normalizeText('Looking for venture capital funding'), 'api'), false);
  assert.equal(containsKeyword(normalizeText('Build a RAG system for docs'), 'rag'), true);
  assert.equal(containsKeyword(normalizeText('Cloud storage and database optimization'), 'rag'), false);
  assert.equal(containsKeyword(normalizeText('ChatGPT and GPT model prompt engineering'), 'gpt'), true);
  assert.equal(containsKeyword(normalizeText('Handle receipt processing'), 'gpt'), false);

  // Arabic short terms
  assert.equal(containsKeyword(normalizeText('مطلوب عمل بوت تيليجرام'), 'بوت'), true);
  assert.equal(containsKeyword(normalizeText('صيانة جهاز كومبيوتر محمول'), 'بوت'), false);
});

test('evaluateProject scores correctly and triggers match when score >= 4', () => {
  // n8n (3) + python (2) = 5 -> MATCH
  const p1 = baseProject({
    title: 'Automate customer leads with n8n and Python',
    description: 'We need an automation pipeline connecting HubSpot to database via webhooks.',
  });
  const res1 = evaluateProject(p1);
  assert.equal(res1.matched, true);
  assert.ok(res1.score >= 5);
  assert.ok(res1.strongMatches.includes('n8n'));
  assert.ok(res1.mediumMatches.includes('python'));

  // python (2) + script (1) = 3 -> NOT ENOUGH (needs 4)
  const p2 = baseProject({
    title: 'Simple python script for excel',
    description: 'Small helper tool.',
  });
  const res2 = evaluateProject(p2);
  assert.equal(res2.matched, false);
  assert.equal(res2.score, 3);
});

test('evaluateProject excludes immediately if an EXCLUDE keyword is present', () => {
  const p = baseProject({
    title: 'n8n and Python automation for WordPress WooCommerce site',
    description: 'We use OpenAI and Python for our WordPress store.',
  });
  const res = evaluateProject(p);
  assert.equal(res.matched, false);
  assert.equal(res.score, 0);
  assert.ok(res.excludedBy === 'wordpress' || res.excludedBy === 'woocommerce');
});

test('evaluateProject skips projects under minimum budget threshold', () => {
  const p = baseProject({
    title: 'Build n8n and Python workflow',
    description: 'Automate tasks with langchain and openai',
    budgetMin: 5,
    budgetMax: 10,
    currency: 'USD',
  });
  const res = evaluateProject(p, { minBudgetUsd: 15 });
  assert.equal(res.matched, false);
  assert.equal(res.budgetSkipped, true);
});

test('evaluateProject allows projects without budget specified or >= 15', () => {
  const p = baseProject({
    title: 'Build n8n and Python workflow',
    description: 'Automate tasks with langchain and openai',
    budgetMin: 50,
    budgetMax: 100,
    currency: 'USD',
  });
  const res = evaluateProject(p, { minBudgetUsd: 15 });
  assert.equal(res.matched, true);
});
