import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSmartTemplate, generateProposal } from './bid-generator.ts';
import { formatProjectMessage } from './telegram.ts';
import type { NormalizedProject } from '../adapters/types.ts';
import type { MatchResult } from './matcher.ts';

const mockMatch: MatchResult = {
  matched: true,
  score: 6,
  strongMatches: ['n8n', 'whatsapp bot'],
  mediumMatches: ['python'],
  weakMatches: ['script'],
};

test('generateSmartTemplate produces Arabic proposal for Arabic project', () => {
  const arabicProject: NormalizedProject = {
    platform: 'mostaql',
    externalId: '101',
    title: 'مطلوب بوت واتساب وربط مع جوجل شيت',
    description: 'نحتاج مستقل خبير بأتمتة n8n وربط واتساب',
    url: 'https://mostaql.com/project/101',
    skills: ['n8n', 'python'],
    postedAt: new Date(),
  };

  const proposal = generateSmartTemplate(arabicProject, mockMatch);
  assert.ok(proposal.includes('السلام عليكم ورحمة الله'));
  assert.ok(proposal.includes('n8n') || proposal.includes('whatsapp bot'));
  assert.ok(!proposal.includes('['), 'Must not contain placeholder brackets');
});

test('generateSmartTemplate produces English proposal for English project', () => {
  const englishProject: NormalizedProject = {
    platform: 'freelancer',
    externalId: '202',
    title: 'Build automated workflow with n8n and Python',
    description: 'Connect our CRM to database using webhooks.',
    url: 'https://www.freelancer.com/projects/202',
    skills: ['n8n', 'Python'],
    postedAt: new Date(),
  };

  const proposal = generateSmartTemplate(englishProject, mockMatch);
  assert.ok(proposal.includes('Hi there'));
  assert.ok(proposal.includes('n8n') || proposal.includes('Python'));
  assert.ok(!proposal.includes('['), 'Must not contain placeholder brackets');
});

test('formatProjectMessage wraps proposal in tap-to-copy <pre><code> block', () => {
  const project: NormalizedProject = {
    platform: 'nafezly',
    externalId: '303',
    title: 'تطوير سكربت بايثون لتحليل البيانات',
    url: 'https://nafezly.com/projects/303',
    skills: ['python'],
    postedAt: new Date(),
  };

  const msgWithProposal = formatProjectMessage(project, mockMatch, 'Test Proposal Content');
  assert.ok(msgWithProposal.includes('<pre><code>Test Proposal Content</code></pre>'));
  assert.ok(msgWithProposal.includes('Tap box to copy'));
});

test('generateProposal returns a proposal even without external API keys', async () => {
  const project: NormalizedProject = {
    platform: 'freelance-arabs',
    externalId: '404',
    title: 'مطلوب مبرمج لربط API',
    url: 'https://freelancearabs.com/project/404',
    skills: ['api'],
    postedAt: new Date(),
  };

  const proposal = await generateProposal(project, mockMatch);
  assert.ok(proposal.length > 50);
});
