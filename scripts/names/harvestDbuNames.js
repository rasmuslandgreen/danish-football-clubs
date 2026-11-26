/**
 * Harvests the everyday club names DBU uses in fixtures and league tables.
 *
 * DBU klubcms sites render each team in match widgets and standings as its
 * crest (file.dbu.dk/images/club/{dbuId}/…) followed by the team name, which is
 * the club's registered short name: "FB", "Vanløse", "B.93", "Frem (3)"…
 * Crawling the homepage + team pages of every klubcms site collects those names
 * per dbuId, with how often each was seen.
 *
 * Output: dbuTeamNames.json  { dbuId: { "FB": 35, "FB U15": 2, … } }  (raw, uncleaned)
 *
 * Usage: node scripts/names/harvestDbuNames.js     Env: PAGES_PER_SITE=80  LIMIT_SITES=…
 */

import { join } from 'path';
import { ROOT, readJson, writeJson, fetchHtml, sleep } from '../logos/lib.js';

const OUT_PATH       = join(ROOT, 'dbuTeamNames.json');
const PAGES_PER_SITE = parseInt(process.env.PAGES_PER_SITE ?? '80', 10);
const LIMIT_SITES    = parseInt(process.env.LIMIT_SITES ?? '0', 10) || Infinity;
const CONCURRENCY    = 6;

const sites = readJson(join(ROOT, 'clubsCmsClassification.json'), { results: [] }).results
  .filter(r => r.classification === 'dbu-klubcms' && r.website)
  .map(r => r.website)
  .slice(0, LIMIT_SITES);

export const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

const names = new Map(); // dbuId → Map(name → count)

function harvest(html) {
  // crest image, then the first piece of visible text within ~700 chars = the team name
  for (const m of html.matchAll(/file\.dbu\.dk\/images\/club\/(\d+)\/[^"']+["'][^>]*>([\s\S]{0,700})/g)) {
    const parts = m[2].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '\n').split('\n').map(decode).filter(Boolean);
    const name = parts.find(s => /[A-Za-zÆØÅæøå]/.test(s) && s.length <= 50 && !/^(vs\.?|-|–|kl\.?|\d)/i.test(s));
    if (!name) continue;
    if (!names.has(m[1])) names.set(m[1], new Map());
    const e = names.get(m[1]);
    e.set(name, (e.get(name) ?? 0) + 1);
  }
}

function teamPages(html, base) {
  const links = [...new Set([...html.matchAll(/href="(\/hold\/[^"#?]+)"/g)].map(m => m[1]))];
  return links
    .filter(l => !/spillertrup|traenere|bestyrelse|vedtaegt|statistik|retro|kontakt/i.test(l))
    .slice(0, PAGES_PER_SITE)
    .map(l => new URL(l, base).href);
}

let done = 0;
const queue = [...sites];
async function worker() {
  while (queue.length) {
    const site = queue.shift();
    try {
      const { html, finalUrl } = await fetchHtml(site);
      harvest(html);
      for (const page of teamPages(html, finalUrl)) {
        try { harvest((await fetchHtml(page)).html); } catch {}
        await sleep(250);
      }
    } catch {}
    if (++done % 25 === 0) console.log(`  ${done}/${sites.length} sites, ${names.size} clubs so far`);
  }
}

console.log(`Harvesting DBU team names from ${sites.length} klubcms sites…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const out = Object.fromEntries([...names].sort((a, b) => a[0] - b[0])
  .map(([id, m]) => [id, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))]));
writeJson(OUT_PATH, out);
console.log(`\n✓ dbuTeamNames.json: names for ${Object.keys(out).length} clubs`);
