/**
 * Harvests official DBU club crests.
 *
 * DBU klubcms sites render match widgets and league tables with both teams'
 * crests, served from file.dbu.dk/images/club/{dbuId}/{File}_logo_136.png.
 * The same path without "_logo_136" is the full-resolution original.
 *
 * Crawling every klubcms site (homepage + a few /hold/ pages) therefore yields
 * official crests for most clubs in the country, keyed by dbuId.
 *
 * Output: dbuLogoIndex.json  { dbuId: { files: [fileName…], seenOn: n } }
 *
 * Usage: node scripts/logos/harvestDbuLogos.js
 * Env:   PAGES_PER_SITE=12  (default)   LIMIT_SITES=30
 */

import { join } from 'path';
import { ROOT, readJson, writeJson, fetchHtml, sleep } from './lib.js';

const OUT_PATH       = join(ROOT, 'dbuLogoIndex.json');
const PAGES_PER_SITE = parseInt(process.env.PAGES_PER_SITE ?? '12', 10);
const LIMIT_SITES    = parseInt(process.env.LIMIT_SITES ?? '0', 10) || Infinity;
const CONCURRENCY    = 6;

const sites = readJson(join(ROOT, 'clubsCmsClassification.json'), { results: [] }).results
  .filter(r => r.classification === 'dbu-klubcms' && r.website)
  .map(r => r.website)
  .slice(0, LIMIT_SITES);

const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');

// dbuId → { files:Set, seenOn:number }. Starts from the previous run so a
// deeper crawl only adds to what's already known.
const index = new Map(Object.entries(readJson(OUT_PATH, {}))
  .map(([id, e]) => [+id, { files: new Set(e.files), seenOn: e.seenOn }]));
const knownBefore = index.size;

function harvest(html) {
  for (const m of html.matchAll(/file\.dbu\.dk\/images\/club\/(\d+)\/([^"'\s<>)]+?)(?:_logo_\d+)?\.(png|jpe?g|gif|svg|webp)/gi)) {
    const id = +m[1];
    const file = decode(`${m[2]}.${m[3]}`);
    if (!index.has(id)) index.set(id, { files: new Set(), seenOn: 0 });
    const e = index.get(id);
    e.files.add(file);
    e.seenOn++;
  }
}

function teamPages(html, base) {
  const links = [...new Set([...html.matchAll(/href="(\/hold\/[^"#?]+)"/g)].map(m => m[1]))];
  // league tables first (whole pool of clubs), then plain team pages
  links.sort((a, b) => /stilling/.test(b) - /stilling/.test(a) || a.split('/').length - b.split('/').length);
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
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${sites.length} sites, ${index.size} clubs so far`);
  }
}

console.log(`Harvesting DBU crests from ${sites.length} klubcms sites…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const out = Object.fromEntries([...index].sort((a, b) => a[0] - b[0])
  .map(([id, e]) => [id, { files: [...e.files], seenOn: e.seenOn }]));
writeJson(OUT_PATH, out);

const clubs  = readJson(join(ROOT, 'clubs.json'), []);
const known  = new Set(clubs.map(c => c.dbuId));
const noLogo = new Set(clubs.filter(c => !c.logo).map(c => c.dbuId));
const ids    = Object.keys(out).map(Number);
console.log(`\n✓ dbuLogoIndex.json: ${ids.length} clubs with a DBU crest (+${ids.length - knownBefore} new this run)`);
console.log(`  in clubs.json: ${ids.filter(i => known.has(i)).length}, without logo today: ${ids.filter(i => noLogo.has(i)).length}`);
