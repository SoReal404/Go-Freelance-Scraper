import { mkdir, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';

const listings = [
  ['shoghlonline', 'https://shoghlonline.com/jobs'],
  ['nafezly', 'https://nafezly.com/projects'],
  ['freelance-arabs', 'https://arabsfreelancer.com/projects/'],
  ['kafiil', 'https://kafiil.com/projects'],
  ['bahr', 'https://bahr.sa/projects?page=1'],
  ['ureed', 'https://app.ureed.com/find-projects'],
  ['taskats', 'https://taskats.com/jobs'],
];
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
await mkdir(new URL('./samples/', import.meta.url), { recursive: true });
await Promise.all(listings.map(async ([id, url]) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
    const html = await response.text();
    const $ = load(html);
    await writeFile(new URL(`./samples/${id}-listing.html`, import.meta.url), html, 'utf8');
    const links = $('a[href]').toArray().map((a) => ({
      href: $(a).attr('href'),
      text: $(a).text().replace(/\s+/g, ' ').trim(),
      cls: $(a).attr('class') ?? '',
    })).filter((a) => /project|job|task|recruit|مشروع|وظيف|عمل/i.test(`${a.href} ${a.text} ${a.cls}`)).slice(0, 15);
    console.log(JSON.stringify({ id, url, finalUrl: response.url, status: response.status, bytes: html.length, title: $('title').text().trim(), links }));
  } catch (error) {
    console.log(JSON.stringify({ id, url, error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown' }));
  }
}));
