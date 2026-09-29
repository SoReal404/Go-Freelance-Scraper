import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';

const clean = (value) => value?.replace(/\s+/g, ' ').trim();
for (const id of ['shoghlonline', 'nafezly', 'freelance-arabs']) {
  const $ = load(await readFile(new URL(`./samples/${id}-listing.html`, import.meta.url), 'utf8'));
  if (id === 'shoghlonline') {
    console.log(JSON.stringify({ id, times: [...new Set($('a[href^="/jobs/"]').filter((_i, node) => clean($(node).text()).length > 5).toArray().map((node) => clean($(node).closest('div.flex.items-start.gap-4').find('h2').parent().find('.mt-1 span').first().text())).filter(Boolean))] }));
    const cards = $('a[href^="/jobs/"]').filter((_i, node) => clean($(node).text()).length > 5).slice(0, 5).toArray().map((node) => $(node).closest('div.flex.items-start.gap-4'));
    for (const card of cards) console.log(JSON.stringify({ id, title: clean(card.find('h2').first().text()), url: card.find('h2 a').attr('href'), times: card.find('h2').parent().find('.mt-1 span').toArray().map((x) => clean($(x).text())), description: clean(card.find('p.mt-3').first().text()), skills: card.find('.mt-3.flex.flex-wrap span').toArray().map((x) => clean($(x).text())), currencyText: card.text().match(/.{0,40}(?:\$|جنيه|ريال|EGP|SAR).{0,40}/g) }));
  }
  if (id === 'nafezly') {
    console.log(JSON.stringify({ id, times: [...new Set($('.project-box .fa-clock').toArray().map((node) => clean($(node).parent().text())).filter(Boolean))] }));
    for (const card of $('.project-box').slice(0, 4).toArray()) {
      const c = $(card);
      console.log(JSON.stringify({ id, title: clean(c.find('a[href*="/project/"]').not('[href*="create"]').first().text()), url: c.find('a[href*="/project/"]').not('[href*="create"]').first().attr('href'), description: clean(c.find('h3').first().text()), money: c.find('.fa-usd-circle').parent().text(), time: c.find('.fa-clock').parent().text(), skillCount: c.find('[class*="skill"]').length, cardEnd: clean(c.text()).slice(-180) }));
    }
  }
  if (id === 'freelance-arabs') {
    for (const card of $('div.projects').slice(0, 5).toArray()) {
      const c = $(card);
      console.log(JSON.stringify({ id, idClass: c.attr('class'), title: clean(c.find('.fr-latest-content h3').first().text()), url: c.find('.fr-latest-content h3 a').attr('href'), date: clean(c.find('.fr-latest-profile').eq(1).text()), description: clean(c.find('.fr-latest-container p').first().text()), moneyText: c.text().match(/.{0,30}(?:\$|جنيه|ريال|EGP|SAR).{0,30}/g) }));
    }
  }
}
