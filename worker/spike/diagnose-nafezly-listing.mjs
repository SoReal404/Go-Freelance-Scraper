import { readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { fetchNafezlyHtml, parseNafezlyProjects } from '../adapters/nafezly.ts';

const response = await fetchNafezlyHtml();
console.log(JSON.stringify({ status: response.status, url: response.url, bytes: response.html.length, title: load(response.html)('title').text().trim() }));
if (response.status !== 200) process.exit(1);
await writeFile(new URL('./samples/nafezly-listing.html', import.meta.url), response.html, 'utf8');
const $ = load(response.html);
const rows = $('.project-box').toArray().map((node) => {
  const card = $(node);
  return {
    title: card.find('a.text-truncate[href*="/project/"]').not('[href*="create"]').first().text().trim(),
    href: card.find('a.text-truncate[href*="/project/"]').not('[href*="create"]').first().attr('href'),
    time: card.find('.fa-clock').first().parent().text().replace(/\s+/g, ' ').trim(),
    budget: card.find('.fa-usd-circle').first().parent().text().replace(/\s+/g, ' ').trim(),
  };
});
const parsed = parseNafezlyProjects(response.html);
console.log(JSON.stringify({ rowCount: parsed.rowCount, parsed: parsed.projects.length, parseErrors: parsed.parseErrors, rows }));
