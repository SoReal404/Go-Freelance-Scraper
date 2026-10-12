import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePphInitialState, parsePphProject } from './peopleperhour.ts';
import type { PphRawProject } from './peopleperhour.ts';

test('parsePphInitialState extracts project records from script tag', () => {
  const fakeHtml = `
    <html>
      <head></head>
      <body>
        <script>
          window.PPHReact={};
          window.PPHReact.initialState={"entities":{"projects":{"101":{"id":"101","attributes":{"title":"Test Project","proj_desc":"Details","budget":50,"currency":"GBP"}}}}};
    window.PPHReact.data={user: {}};
        </script>
      </body>
    </html>
  `;

  const parsed = parsePphInitialState(fakeHtml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '101');
  assert.equal(parsed[0].attributes?.title, 'Test Project');
});

test('parsePphProject normalizes PeoplePerHour attributes correctly', () => {
  const raw: PphRawProject = {
    id: '4524051',
    attributes: {
      proj_id: 4524051,
      title: 'Website Development Assistance',
      proj_desc: 'Full stack development needed for e-commerce website.',
      budget: 150,
      currency: 'GBP',
      project_type: 'fixed',
      url: 'https://www.peopleperhour.com/freelance-jobs/tech/website-dev-4524051',
      category: { cate_name: 'Technology & Programming' },
      sub_category: { subcate_name: 'Website Development' },
      posted_dt: '2026-09-29 12:30:37',
    },
  };

  const project = parsePphProject(raw);
  assert.ok(project);
  assert.equal(project.platform, 'peopleperhour');
  assert.equal(project.externalId, '4524051');
  assert.equal(project.title, 'Website Development Assistance');
  assert.equal(project.budgetMin, 150);
  assert.equal(project.currency, 'GBP');
  assert.equal(project.budgetType, 'fixed');
  assert.deepEqual(project.skills, ['Technology & Programming', 'Website Development']);
});
