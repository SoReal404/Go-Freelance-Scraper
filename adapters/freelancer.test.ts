import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFreelancerProject } from './freelancer.ts';
import type { FreelancerApiProject } from './freelancer.ts';

test('parseFreelancerProject correctly normalizes project data', () => {
  const sample: FreelancerApiProject = {
    id: 40740179,
    title: '  Comprehensive SEO Traffic Boost  ',
    description: 'This is the full project description with detailed audit instructions and deliverables.',
    preview_description: 'This is the preview.',
    seo_url: 'keyword-research/Comprehensive-SEO-Traffic-Boost-40740179',
    currency: {
      code: 'USD',
      sign: '$',
    },
    budget: {
      minimum: 250,
      maximum: 750,
    },
    type: 'fixed',
    jobs: [
      { id: 38, name: 'SEO' },
      { id: 1085, name: 'Keyword Research' },
      { id: 40, name: 'Link Building' },
    ],
    submitdate: 1790679222,
  };

  const normalized = parseFreelancerProject(sample);

  assert.equal(normalized.platform, 'freelancer');
  assert.equal(normalized.externalId, '40740179');
  assert.equal(normalized.title, 'Comprehensive SEO Traffic Boost');
  assert.equal(normalized.description, sample.description);
  assert.equal(normalized.url, 'https://www.freelancer.com/projects/keyword-research/Comprehensive-SEO-Traffic-Boost-40740179');
  assert.equal(normalized.budgetMin, 250);
  assert.equal(normalized.budgetMax, 750);
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.budgetType, 'fixed');
  assert.deepEqual(normalized.skills, ['SEO', 'Keyword Research', 'Link Building']);
  assert.equal(normalized.detailsEnriched, true);
  assert.ok(normalized.postedAt instanceof Date);
});

test('parseFreelancerProject handles null jobs and null description', () => {
  const sample: FreelancerApiProject = {
    id: 12345,
    title: 'Quick Task',
    description: null,
    preview_description: 'Just a preview',
    currency: null,
    budget: null,
    jobs: null,
  };

  const normalized = parseFreelancerProject(sample);
  assert.equal(normalized.externalId, '12345');
  assert.equal(normalized.description, 'Just a preview');
  assert.deepEqual(normalized.skills, []);
  assert.equal(normalized.url, 'https://www.freelancer.com/projects/12345');
});
