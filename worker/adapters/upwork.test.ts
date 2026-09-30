import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpworkNode } from './upwork.ts';
import type { UpworkGqlEdge } from './upwork.ts';

test('parseUpworkNode correctly normalizes GraphQL edge node', () => {
  const edgeNode: UpworkGqlEdge['node'] = {
    id: '~019842fbc947a1',
    title: 'Senior Node.js & TypeScript Backend Engineer',
    description: 'We need an experienced engineer to build high-scale scrapers and microservices.',
    category: { name: 'Web & Mobile Development' },
    skills: [{ name: 'Node.js' }, { name: 'TypeScript' }, { name: 'Web Scraping' }],
    amount: {
      amount: 1500,
      currencyCode: 'USD',
    },
    createdDateTime: '2026-09-30T01:15:00.000Z',
    hourlyBudgetType: '',
  };

  const normalized = parseUpworkNode(edgeNode);

  assert.equal(normalized.platform, 'upwork');
  assert.equal(normalized.externalId, '~019842fbc947a1');
  assert.equal(normalized.title, 'Senior Node.js & TypeScript Backend Engineer');
  assert.equal(normalized.budgetMin, 1500);
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.budgetType, 'fixed');
  assert.deepEqual(normalized.skills, ['Node.js', 'TypeScript', 'Web Scraping']);
  assert.equal(normalized.url, 'https://www.upwork.com/jobs/~019842fbc947a1');
});
