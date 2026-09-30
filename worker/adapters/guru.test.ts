import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGuruBudget, parseGuruProjects } from './guru.ts';

test('parseGuruBudget correctly parses budget ranges and types', () => {
  const range = parseGuruBudget('Fixed Price: $500 - $1,000');
  assert.equal(range.budgetMin, 500);
  assert.equal(range.budgetMax, 1000);
  assert.equal(range.currency, 'USD');
  assert.equal(range.budgetType, 'fixed');

  const hourly = parseGuruBudget('Hourly: $25 - $50/hr');
  assert.equal(hourly.budgetMin, 25);
  assert.equal(hourly.budgetMax, 50);
  assert.equal(hourly.currency, 'USD');
  assert.equal(hourly.budgetType, 'hourly');
});

test('parseGuruProjects parses mock job cards', () => {
  const sampleHtml = `
    <div class="record">
      <h2 class="jobTitle"><a href="/d/jobs/c/12345/full-stack-dev">Full Stack Developer Needed</a></h2>
      <p class="record__desc">Looking for a full stack developer for our SaaS app.</p>
      <div class="record__budget">$1,500 - $3,000</div>
      <div class="record__skills">
        <a href="/d/jobs/s/react">React</a>
        <a href="/d/jobs/s/nodejs">Node.js</a>
      </div>
    </div>
  `;

  const result = parseGuruProjects(sampleHtml);
  assert.equal(result.projects.length, 1);
  const p = result.projects[0];
  assert.equal(p.platform, 'guru');
  assert.equal(p.title, 'Full Stack Developer Needed');
  assert.equal(p.budgetMin, 1500);
  assert.equal(p.budgetMax, 3000);
  assert.deepEqual(p.skills, ['React', 'Node.js']);
});
