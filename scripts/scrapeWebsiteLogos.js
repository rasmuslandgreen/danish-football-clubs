/**
 * Scrapes club websites built on the DBU theme for their footer logo.
 *
 * The DBU club theme renders a footer logo as:
 *   <img src="/media/…/filename.png" class="footerLogo" alt="footerLogo">
 *
 * This script fetches each club's website, looks for that element, resolves
 * the image URL, and downloads it to assets/logos-raw/{dbuId}.{ext} for review.
 *
 * Workflow:
 *   node scripts/scrapeWebsiteLogos.js
 *   # review assets/logos-raw/ — delete bad ones
 *   npm run logos   (mergeLogos + buildIndex)
 *
 * Usage flags (env):
 *   ONLY_IDS=1234,5678   limit to specific dbuIds
 *   FORCE=1              re-download even if logos-raw already has the file
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const DELAY_MS  = 800;
const OUT_DIR   = 'assets/logos-raw';
const LOGOS_DIR = 'assets/logos';

const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });

const ONLY_IDS = process.env.ONLY_IDS
  ? new Set(process.env.ONLY_IDS.split(',').map(s => parseInt(s.trim(), 10)))
  : null;
const FORCE = !!process.env.FORCE;

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

// Find the first footerLogo src in raw HTML via regex — no DOM parser needed
// Matches: class="footerLogo" or class='footerLogo' anywhere on the img tag
function extractFooterLogoSrc(html) {
  // Match any <img ...> that contains class="footerLogo" or class='footerLogo'
  const imgRe = /<img\b[^>]*\bclass=["'][^"']*footerLogo[^"']*["'][^>]*>/gi;
  const srcRe = /\bsrc=["']([^"']+)["']/i;
  let match;
  while ((match = imgRe.exec(html)) !== null) {
    const srcMatch = srcRe.exec(match[0]);
    if (srcMatch) return srcMatch[1];
  }
  return null;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': 'danish-football-clubs/1.0 (logo scraper; github.com/rasmuslandgreen)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url };
}

async function downloadImage(url, dbuId) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'danish-football-clubs/1.0 (logo scraper)' },
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  let ext = extname(new URL(url).pathname).toLowerCase();
  if (!ext) {
    if (contentType.includes('png'))  ext = '.png';
    else if (contentType.includes('svg')) ext = '.svg';
    else if (contentType.includes('webp')) ext = '.webp';
    else ext = '.jpg';
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error(`Image too small (${buf.length} bytes) — likely a placeholder`);

  const outPath = join(OUT_DIR, `${dbuId}${ext}`);
  writeFileSync(outPath, buf);
  return { outPath, ext, bytes: buf.length };
}

const candidates = clubs.filter(c => {
  if (!c.website) return false;
  if (ONLY_IDS && !ONLY_IDS.has(c.dbuId)) return false;
  if (!FORCE && hasLogo(c.dbuId)) return false;
  if (!FORCE && hasRaw(c.dbuId)) return false;
  return true;
});

console.log(`Scraping ${candidates.length} clubs with websites (no logo yet)\n`);

let found = 0, skipped = 0, failed = 0;

for (const club of candidates) {
  try {
    const { html, finalUrl } = await fetchHtml(club.website);
    const src = extractFooterLogoSrc(html);

    if (!src) {
      process.stdout.write(`  – [${club.dbuId}] ${club.name}: ingen footerLogo fundet\n`);
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    const imageUrl = new URL(src, finalUrl).href;
    const { outPath, bytes } = await downloadImage(imageUrl, club.dbuId);
    process.stdout.write(`  ✓ [${club.dbuId}] ${club.name}: ${imageUrl} → ${outPath} (${Math.round(bytes / 1024)} KB)\n`);
    found++;
  } catch (err) {
    process.stdout.write(`  ✗ [${club.dbuId}] ${club.name} (${club.website}): ${err.message}\n`);
    failed++;
  }

  await sleep(DELAY_MS);
}

console.log(`\nFærdig. Fundet: ${found}, ingen logo: ${skipped}, fejl: ${failed}`);
console.log(`Gennemse assets/logos-raw/, slet de dårlige, kør derefter npm run logos`);
