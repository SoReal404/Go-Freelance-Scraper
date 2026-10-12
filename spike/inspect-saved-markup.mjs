import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';

for (const id of ['shoghlonline', 'nafezly', 'freelance-arabs', 'bahr', 'ureed', 'taskats', 'kafiil']) {
  try {
    const html = await readFile(new URL(`./samples/${id}-listing.html`, import.meta.url), 'utf8');
    const $ = load(html);
    const scripts = $('script').toArray().map((node) => ({
      type: $(node).attr('type'), id: $(node).attr('id'), length: $(node).html()?.length ?? 0,
    })).filter((script) => script.type === 'application/json' || script.id?.includes('data') || script.type === 'application/ld+json');
    const selector = id === 'shoghlonline' ? 'a[href^="/jobs/"]' : id === 'nafezly' ? 'a[href*="/project/"]' : id === 'freelance-arabs' ? 'div.projects' : 'a[href]';
    const anchors = id === 'bahr' ? [] : $(selector).filter((_index, node) => {
      if (id === 'shoghlonline') return $(node).attr('href')?.startsWith('/jobs/') && $(node).text().trim().length > 5;
      if (id === 'nafezly') return $(node).attr('href')?.includes('/project/') && !$(node).attr('href')?.includes('create') && $(node).text().trim().length > 5;
      return true;
    }).slice(0, 2).toArray();
    const ancestors = anchors.map((anchor) => {
      let node = $(anchor);
      const levels = [];
      for (let depth = 0; depth < 6 && node.length; depth += 1, node = node.parent()) {
        levels.push({ tag: node[0]?.tagName, cls: node.attr('class'), text: node.text().replace(/\s+/g, ' ').trim().slice(0, 360) });
      }
      return { levels, html: id === 'freelance-arabs' ? $(anchor).html()?.slice(0, 3000) : undefined };
    });
    const textNeedles = ['مطلوب خبير ذكاء اصطناعي', 'مطلوب مصممة محتوى', 'مفتوح اريد شخص'];
    const needleMatches = textNeedles.map((needle) => ({ needle, index: html.indexOf(needle), excerpt: html.includes(needle) ? html.slice(Math.max(0, html.indexOf(needle) - 180), html.indexOf(needle) + 500) : '' })).filter((item) => item.index >= 0);
    const allScripts = id === 'bahr' ? $('script').toArray().map((node) => ({ type: $(node).attr('type'), src: $(node).attr('src'), length: $(node).html()?.length ?? 0, hasRecruitmentPath: /recruitments/.test($(node).html() ?? '') })).slice(0, 30) : [];
    const targetScript = id === 'bahr' ? $('script').toArray().map((node) => $(node).html() ?? '').find((script) => /recruitments|مشروع منشور/.test(script)) : undefined;
    console.log(JSON.stringify({ id, title: $('title').text().trim(), scripts, ancestors, needleMatches, allScripts, bahrScriptSample: targetScript?.slice(0, 1800) }));
  } catch (error) {
    console.log(JSON.stringify({ id, error: error instanceof Error ? error.message : 'unknown' }));
  }
}
