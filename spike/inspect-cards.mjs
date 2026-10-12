import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';

const clean = (value) => value?.replace(/\s+/g, ' ').trim();
for (const id of ['shoghlonline', 'nafezly', 'freelance-arabs']) {
  const html = await readFile(new URL(`./samples/${id}-listing.html`, import.meta.url), 'utf8');
  const $ = load(html);
  let cards;
  if (id === 'shoghlonline') cards = $('a[href^="/jobs/"]').filter((_i, node) => clean($(node).text()).length > 5).map((_i, node) => $(node).closest('div.flex.items-start.gap-4')).get();
  if (id === 'nafezly') cards = $('.project-box').slice(0, 2).toArray();
  if (id === 'freelance-arabs') cards = $('div.projects').slice(0, 2).toArray();
  console.log(`## ${id} cards=${cards?.length}`);
  for (const card of cards ?? []) {
    const c = $(card);
    console.log(JSON.stringify({ cls: c.attr('class'), text: clean(c.text()).slice(0, 1400), html: c.html()?.slice(0, 4000) }));
  }
}
