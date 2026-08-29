/**
 * Queries Wikidata for Danish football clubs with a logo image (P154),
 * matches them to clubs.json by name, and downloads logos to assets/logos-raw/
 *
 * Usage:
 *   node scripts/scrapeWikidataLogos.js
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const OUT_DIR   = 'assets/logos-raw';
const LOGOS_DIR = 'assets/logos';

const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));
mkdirSync(OUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

function hasLogo(dbuId) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    if (existsSync(join(LOGOS_DIR, `${dbuId}${ext}`))) return true;
  }
  return false;
}

function hasRaw(dbuId) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    if (existsSync(join(OUT_DIR, `${dbuId}${ext}`))) return true;
  }
  return false;
}

// Normalise a club name for fuzzy matching
function normalise(str) {
  return str
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ') // strip parentheticals
    .replace(/[.\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWikidataLogos() {
  const sparql = `
    SELECT ?item ?itemLabel ?logo WHERE {
      ?item wdt:P31/wdt:P279* wd:Q476028 .
      ?item wdt:P17 wd:Q35 .
      ?item wdt:P154 ?logo .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "da,en" }
    }
  `;

  const url = 'https://query.wikidata.org/sparql?' + new URLSearchParams({
    query:  sparql,
    format: 'json',
  });

  console.log('Querying Wikidata for Danish football clubs with logos…');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'danish-football-clubs/1.0 (logo scraper; github.com/rasmuslandgreen/danish-football-clubs)',
      'Accept': 'application/sparql-results+json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Wikidata query failed: ${res.status}`);
  const json = await res.json();

  return json.results.bindings.map(b => ({
    wikidataName: b.itemLabel?.value ?? '',
    logoUrl:      b.logo?.value ?? '',
  })).filter(r => r.logoUrl);
}

async function downloadImage(imageUrl, dbuId) {
  const cleanUrl = imageUrl.split('?')[0];
  let ext = extname(cleanUrl).toLowerCase();
  if (!ext || ext.length > 5) ext = '.png';

  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'danish-football-clubs/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;

  const dest = join(OUT_DIR, `${dbuId}${ext}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function main() {
  const results = await fetchWikidataLogos();
  console.log(`Wikidata returned ${results.length} Danish football clubs with logos\n`);

  // Build normalised lookup from our clubs
  const clubIndex = clubs.map(c => ({
    ...c,
    norm: normalise(c.name),
  }));

  let matched   = 0;
  let skipped   = 0;
  let noMatch   = 0;
  const unmatched = [];

  for (const { wikidataName, logoUrl } of results) {
    const normWikidata = normalise(wikidataName);

    // Try exact match first, then partial
    let club = clubIndex.find(c => c.norm === normWikidata);
    if (!club) {
      club = clubIndex.find(c =>
        c.norm.includes(normWikidata) || normWikidata.includes(c.norm)
      );
    }

    if (!club) {
      noMatch++;
      unmatched.push(wikidataName);
      console.log(`  ? No match for: "${wikidataName}"`);
      continue;
    }

    if (hasLogo(club.dbuId) || hasRaw(club.dbuId)) {
      skipped++;
      console.log(`  – ${club.name}  (already have logo)`);
      continue;
    }

    const dest = await downloadImage(logoUrl, club.dbuId);
    if (dest) {
      matched++;
      console.log(`  ✓ ${club.name}  →  ${dest}`);
    } else {
      noMatch++;
      unmatched.push(wikidataName);
      console.log(`  ✗ ${club.name}  (download failed)`);
    }

    await sleep(300);
  }

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Downloaded: ${matched}`);
  console.log(`– Skipped (already have): ${skipped}`);
  console.log(`? No match in clubs.json: ${noMatch}`);

  if (unmatched.length) {
    writeFileSync(join(OUT_DIR, 'unmatched.txt'), unmatched.join('\n'), 'utf8');
    console.log(`\nUnmatched Wikidata names saved to ${OUT_DIR}/unmatched.txt`);
  }

  console.log(`\nReview assets/logos-raw/ in Figma, copy approved logos to assets/logos/, then run npm run logos`);
}

main().catch(err => { console.error(err); process.exit(1); });
