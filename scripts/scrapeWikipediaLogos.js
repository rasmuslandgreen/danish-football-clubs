/**
 * Searches Wikipedia (Danish first, English fallback) for each club and
 * downloads the main infobox image into assets/logos-raw/{dbuId}.{ext}
 *
 * This is a working folder — review images in Figma, clean/resize as needed,
 * then copy the approved ones into assets/logos/ and run npm run logos.
 *
 * Usage:
 *   node scripts/scrapeWikipediaLogos.js
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const DELAY_MS  = 1500;
const OUT_DIR   = 'assets/logos-raw';
const LOGOS_DIR = 'assets/logos';

const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

mkdirSync(OUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Already have a finished logo — skip
function hasLogo(dbuId) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    if (existsSync(join(LOGOS_DIR, `${dbuId}${ext}`))) return true;
  }
  return false;
}

// Already downloaded to working folder — skip
function hasRaw(dbuId) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    if (existsSync(join(OUT_DIR, `${dbuId}${ext}`))) return true;
  }
  return false;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'danish-football-clubs/1.0 (logo scraper; github.com/rasmuslandgreen/danish-football-clubs)' },
  });
  const text = await res.text();
  if (text.trimStart().startsWith('<')) return null; // HTML rate-limit page
  try { return JSON.parse(text); } catch { return null; }
}

async function searchWikipedia(lang, query) {
  const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action:   'query',
    list:     'search',
    srsearch: query,
    srlimit:  1,
    format:   'json',
  });
  const json = await fetchJson(url);
  return json?.query?.search?.[0]?.title ?? null;
}

async function getLogoImage(lang, title) {
  // Step 1 — get all image filenames on the page
  const listUrl = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action:  'query',
    titles:  title,
    prop:    'images',
    imlimit: '50',
    format:  'json',
  });
  const listJson = await fetchJson(listUrl);
  if (!listJson) return null;

  const pages = listJson?.query?.pages ?? {};
  const images = Object.values(pages)[0]?.images ?? [];
  const filenames = images.map(i => i.title); // e.g. "File:Brondby_IF_logo.svg"

  // Step 2 — score each file: prefer SVG, prefer logo/crest/badge/emblem keywords, reject photos
  const LOGO_KEYWORDS  = /logo|crest|badge|emblem|wappen|coat|shield|arms|blazon/i;
  const REJECT_KEYWORDS = /photo|portrait|stadium|ground|aerial|player|kit|jersey|shirt|flag|map|location|icon|soccerball|football_ball|ball\.svg/i;

  const scored = filenames
    .filter(f => !REJECT_KEYWORDS.test(f))
    .filter(f => !f.endsWith('.jpg') && !f.endsWith('.jpeg')) // JPGs are almost always photos
    .filter(f => LOGO_KEYWORDS.test(f)) // must have a logo keyword — SVG alone is not enough
    .map(f => {
      let score = 0;
      if (f.endsWith('.svg')) score += 5;
      if (f.endsWith('.png')) score += 3;
      if (LOGO_KEYWORDS.test(f)) score += 8;
      return { f, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  // Step 3 — resolve the best candidate to an actual URL
  const best = scored[0].f;
  const infoUrl = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action:  'query',
    titles:  best,
    prop:    'imageinfo',
    iiprop:  'url',
    format:  'json',
  });
  const infoJson = await fetchJson(infoUrl);
  if (!infoJson) return null;

  const infoPages = infoJson?.query?.pages ?? {};
  return Object.values(infoPages)[0]?.imageinfo?.[0]?.url ?? null;
}

async function downloadImage(imageUrl, dbuId) {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return false;

  // Determine extension from URL (strip query params first)
  const cleanUrl = imageUrl.split('?')[0];
  let ext = extname(cleanUrl).toLowerCase();
  if (!ext || ext.length > 5) ext = '.png'; // fallback

  const dest = join(OUT_DIR, `${dbuId}${ext}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  return dest;
}

async function main() {
  const todo = clubs.filter(c => c.dbuId && !hasLogo(c.dbuId) && !hasRaw(c.dbuId));

  console.log(`${clubs.length} clubs total`);
  console.log(`${clubs.length - todo.length} already have a logo or raw image — skipping`);
  console.log(`Searching Wikipedia for ${todo.length} clubs…\n`);

  let found = 0;
  let notFound = 0;
  const missed = [];

  for (const club of todo) {
    const { name, dbuId } = club;

    // Strip parenthetical suffixes before searching (e.g. "BK Frem (professional)" → "BK Frem")
    const searchName = name.replace(/\s*\(.*?\)\s*/g, '').trim();

    try {
      // Try Danish Wikipedia first, fall back to English
      let title = await searchWikipedia('da', searchName);
      let lang  = 'da';

      if (!title) {
        title = await searchWikipedia('en', searchName);
        lang  = 'en';
      }

      if (!title) {
        notFound++;
        missed.push(name);
        process.stdout.write(`  ✗ ${name}\n`);
        await sleep(DELAY_MS);
        continue;
      }

      const imageUrl = await getLogoImage(lang, title);

      if (!imageUrl) {
        notFound++;
        missed.push(name);
        process.stdout.write(`  ✗ ${name}  (page found: "${title}" but no logo image)\n`);
        await sleep(DELAY_MS);
        continue;
      }

      const dest = await downloadImage(imageUrl, dbuId);
      if (dest) {
        found++;
        process.stdout.write(`  ✓ ${name}  →  ${dest}\n`);
      } else {
        notFound++;
        missed.push(name);
        process.stdout.write(`  ✗ ${name}  (download failed)\n`);
      }
    } catch (err) {
      notFound++;
      missed.push(name);
      process.stdout.write(`  ✗ ${name}  (${err.message})\n`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Downloaded: ${found}`);
  console.log(`✗ Not found:  ${notFound}`);
  if (missed.length) {
    writeFileSync('assets/logos-raw/missed.txt', missed.join('\n'), 'utf8');
    console.log(`\nClubs with no Wikipedia image saved to assets/logos-raw/missed.txt`);
  }
  console.log(`\nReview assets/logos-raw/ in Figma, then copy approved logos to assets/logos/ and run npm run logos`);
}

main();
